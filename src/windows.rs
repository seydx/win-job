use std::ffi::c_void;
use std::mem::{offset_of, size_of, zeroed};
use std::{io, ptr};

use windows_sys::Win32::Foundation::{CloseHandle, ERROR_MORE_DATA, HANDLE};
use windows_sys::Win32::System::JobObjects::{
  AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicProcessIdList,
  JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
  TerminateJobObject, JOBOBJECT_BASIC_PROCESS_ID_LIST, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
  JOB_OBJECT_LIMIT_BREAKAWAY_OK, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

// no Drop: a garbage-collected Job must not kill its processes, the handle lives until close() or exit
pub struct JobHandle(HANDLE);

impl JobHandle {
  pub fn create(kill_on_close: bool, allow_breakaway: bool) -> io::Result<Self> {
    // null attributes keep the handle out of spawned children, only this process holds the job open
    let handle = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
    if handle.is_null() {
      return Err(io::Error::last_os_error());
    }
    let job = Self(handle);

    let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
    if kill_on_close {
      info.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    }
    if allow_breakaway {
      info.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_BREAKAWAY_OK;
    }
    let ok = unsafe {
      SetInformationJobObject(
        job.0,
        JobObjectExtendedLimitInformation,
        ptr::from_ref(&info).cast::<c_void>(),
        size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
      )
    };
    if ok == 0 {
      let err = io::Error::last_os_error();
      let _ = job.close();
      return Err(err);
    }
    Ok(job)
  }

  pub fn assign(&self, pid: u32) -> io::Result<()> {
    let process = unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid) };
    if process.is_null() {
      return Err(io::Error::last_os_error());
    }
    let ok = unsafe { AssignProcessToJobObject(self.0, process) };
    let result = if ok == 0 {
      Err(io::Error::last_os_error())
    } else {
      Ok(())
    };
    unsafe { CloseHandle(process) };
    result
  }

  pub fn terminate(&self, exit_code: u32) -> io::Result<()> {
    if unsafe { TerminateJobObject(self.0, exit_code) } == 0 {
      return Err(io::Error::last_os_error());
    }
    Ok(())
  }

  pub fn pids(&self) -> io::Result<Vec<u32>> {
    let ids_offset = offset_of!(JOBOBJECT_BASIC_PROCESS_ID_LIST, ProcessIdList);
    let mut capacity = 64;
    loop {
      let bytes = ids_offset + capacity * size_of::<usize>();
      // usize elements keep the buffer aligned for the struct
      let mut buf = vec![0usize; bytes.div_ceil(size_of::<usize>())];
      let ok = unsafe {
        QueryInformationJobObject(
          self.0,
          JobObjectBasicProcessIdList,
          buf.as_mut_ptr().cast::<c_void>(),
          bytes as u32,
          ptr::null_mut(),
        )
      };
      let header = buf.as_ptr().cast::<JOBOBJECT_BASIC_PROCESS_ID_LIST>();
      let (assigned, listed) = unsafe {
        (
          (*header).NumberOfAssignedProcesses as usize,
          (*header).NumberOfProcessIdsInList as usize,
        )
      };
      if ok == 0 {
        let err = io::Error::last_os_error();
        if err.raw_os_error() != Some(ERROR_MORE_DATA as i32) {
          return Err(err);
        }
      } else if listed >= assigned {
        let ids = unsafe { buf.as_ptr().cast::<u8>().add(ids_offset).cast::<usize>() };
        let ids = unsafe { std::slice::from_raw_parts(ids, listed) };
        return Ok(ids.iter().map(|&id| id as u32).collect());
      }
      // the job grew between the calls
      capacity = assigned.max(capacity) + 16;
    }
  }

  pub fn close(self) -> io::Result<()> {
    if unsafe { CloseHandle(self.0) } == 0 {
      return Err(io::Error::last_os_error());
    }
    Ok(())
  }
}
