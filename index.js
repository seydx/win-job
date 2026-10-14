'use strict';

if (process.platform === 'win32') {
  exports.supported = true;
  exports.Job = require('./binding.js').Job;
} else {
  class Job {
    constructor(_options) {}

    assign(_pid) {}

    terminate(_exitCode) {}

    pids() {
      return [];
    }

    close() {}
  }

  exports.supported = false;
  exports.Job = Job;
}
