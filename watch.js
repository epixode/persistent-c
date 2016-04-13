'use strict';

const chokidar = require('chokidar');
const cp = require('child_process');

const watcher = chokidar.watch('./src', {
  ignored: /\/\./,
  persistent: true
});


watcher.on('change', (event, path) => {
  setTimeout(function () {
    console.log(`${(new Date()).toISOString()} changed`);
    cp.exec('npm run build', function (error, stdout, stderr) {
      if (error !== null) {
        console.log(`exec error: ${error}`);
        return;
      }
      if (stderr.trim() !== "") {
        console.log(`stderr: ${stderr}`);
      }
      console.log(`${(new Date()).toISOString()} built`);
      cp.exec('jspm link -y npm:persistent-c', function (error, stdout, stderr) {
        if (error !== null) {
          console.log(`exec error: ${error}`);
          return;
        }
        if (stderr.trim() !== "") {
          console.log(`stderr: ${stderr}`);
        }
        console.log(`${(new Date()).toISOString()} linked`);
      });
    });
  }, 100);
});
