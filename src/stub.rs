use std::io;

pub struct JobHandle;

impl JobHandle {
  pub fn create(_kill_on_close: bool, _allow_breakaway: bool) -> io::Result<Self> {
    Ok(Self)
  }

  pub fn assign(&self, _pid: u32) -> io::Result<()> {
    Ok(())
  }

  pub fn terminate(&self, _exit_code: u32) -> io::Result<()> {
    Ok(())
  }

  pub fn pids(&self) -> io::Result<Vec<u32>> {
    Ok(Vec::new())
  }

  pub fn close(self) -> io::Result<()> {
    Ok(())
  }
}
