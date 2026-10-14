#[cfg_attr(windows, path = "windows.rs")]
#[cfg_attr(not(windows), path = "stub.rs")]
mod sys;

use napi::{Error, Result};
use napi_derive::napi;

use crate::sys::JobHandle;

/// Options for a new `Job`.
#[napi(object)]
pub struct JobOptions {
  /// Kill every process in the job once its last handle closes, on `close()` or when this
  /// process exits or crashes. Defaults to `true`.
  pub kill_on_close: Option<bool>,
  /// Let a process started with `CREATE_BREAKAWAY_FROM_JOB` leave the job. Without it such a
  /// start fails with "access denied". Defaults to `false`.
  pub allow_breakaway: Option<bool>,
}

/// A Windows job object.
///
/// A process assigned to the job stays in it together with every process it starts later,
/// also through `cmd`, Go or Python children. Processes it started before the assignment stay
/// outside, so assign right after the spawn or assign this process itself before spawning.
///
/// The handle is not inherited by children, so with `killOnClose` the whole tree dies with this
/// process. It stays open until `close()` or exit, also when the object is garbage collected.
///
/// On other platforms the package exports a `Job` whose methods do nothing.
#[napi]
pub struct Job {
  handle: Option<JobHandle>,
}

#[napi]
impl Job {
  #[napi(constructor)]
  pub fn new(options: Option<JobOptions>) -> Result<Self> {
    let (kill_on_close, allow_breakaway) =
      options.map_or((None, None), |o| (o.kill_on_close, o.allow_breakaway));
    let handle = JobHandle::create(
      kill_on_close.unwrap_or(true),
      allow_breakaway.unwrap_or(false),
    )
    .map_err(|err| Error::from_reason(format!("create job: {err}")))?;
    Ok(Self {
      handle: Some(handle),
    })
  }

  /// Add a running process to the job. Throws when the process is gone or can't be opened.
  #[napi]
  pub fn assign(&self, pid: u32) -> Result<()> {
    self
      .handle()?
      .assign(pid)
      .map_err(|err| Error::from_reason(format!("assign pid {pid}: {err}")))
  }

  /// Kill every process in the job, this one included when it is assigned.
  /// The exit code defaults to 1.
  #[napi]
  pub fn terminate(&self, exit_code: Option<u32>) -> Result<()> {
    self
      .handle()?
      .terminate(exit_code.unwrap_or(1))
      .map_err(|err| Error::from_reason(format!("terminate job: {err}")))
  }

  /// The ids of all processes in the job that are still running.
  #[napi]
  pub fn pids(&self) -> Result<Vec<u32>> {
    self
      .handle()?
      .pids()
      .map_err(|err| Error::from_reason(format!("list job processes: {err}")))
  }

  /// Close the handle. With `killOnClose` this kills every process in the job, this one
  /// included when it is assigned. Closing again does nothing.
  #[napi]
  pub fn close(&mut self) -> Result<()> {
    match self.handle.take() {
      Some(handle) => handle
        .close()
        .map_err(|err| Error::from_reason(format!("close job: {err}"))),
      None => Ok(()),
    }
  }

  fn handle(&self) -> Result<&JobHandle> {
    self
      .handle
      .as_ref()
      .ok_or_else(|| Error::from_reason("job is closed"))
  }
}
