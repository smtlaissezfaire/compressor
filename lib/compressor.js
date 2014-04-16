

var yaml = require('js-yaml');
var fs = require('fs');
var path = require('path');
var _ = require('underscore');
var async = require('async');
var childProcess = require('child_process');
var glob = require("glob");
var colors = require("colors");
var crypto = require('crypto');

var backtick = function(command, args, options, callback) {
  var stream = childProcess.spawn(command, args, options);
  var stdoutData = '';
  var stderrData = '';

  stream.stdout.on('data', function(data) {
    if (callback) {
      stdoutData += data;
    } else {
      process.stdout.write(data);
    }
  });

  stream.stderr.on('data', function(data) {
    if (callback) {
      stderrData += data;
    } else {
      process.stderr.write(data);
    }
  });

  if (callback) {
    stream.on('exit', function() {
      callback(stderrData, stdoutData);
    });
  }
};

var mapFiles = function(loadPaths, files, cb) {
  async.map(files, function(file, cb) {
    var possibleFiles = _.map(loadPaths, function(loadPath) {
      return path.join(loadPath, file);
    });

    async.map(possibleFiles, function(possibleFile, cb) {
      glob(possibleFile, {}, function(err, files) {
        cb(err, files);
      });
    }, cb);
  }, function(err, files) {
    if (err) {
      return cb(err);
    }

    files = _.flatten(files);

    cb(null, files);
  });
};

var concatenateFiles = function(files, cb) {
  var fileContents = [];

  console.log('files', files);

  async.forEachSeries(files, function(file, cb) {
    fs.readFile(file, function(err, contents) {
      if (err) {
        return cb(err);
      }

      fileContents.push("/* file: " + file + "*/");
      fileContents.push(contents.toString());
      fileContents.push();

      cb();
    })
  }, function(err) {
    if (err) {
      return cb(err);
    }

    cb(null, fileContents.join("\n"));
  });
};

var uglifyFiles = function(files, uglifyOptions, cb) {
  var commandOptions = _.flatten(files, uglifyOptions);
  backtick('uglifyjs', commandOptions, {}, cb);
};

var md5 = function(data) {
  var md5sum = crypto.createHash('md5');
  md5sum.update(data);
  return md5sum.digest('hex');
};

var writeFileWithMD5Name = function(assetVersion, manifestLog, outputDirectory, baseFileName, contents, cb) {
  var digest = md5(assetVersion.toString() + contents);
  var md5FileName = [baseFileName, '-', digest].join("") + ".js";
  manifestLog[baseFileName + ".js"] = md5FileName;

  fs.writeFile(path.join(outputDirectory, md5FileName), contents, { encoding: 'utf8' }, cb);
};

exports.run = function(options) {
  var basePath = options.base_path;
  var yamlFilePath = path.join(basePath, 'js_bundles.yml');

  var yamlFileContents = fs.readFileSync(yamlFilePath, 'utf8');
  var config = yaml.safeLoad(yamlFileContents);

  var loadPaths = config.load_paths;
  var outputDirectory = config.output_directory;
  var bundles = config.bundles;
  var uglifyOptions = config.uglifyOptions || [];
  var assetVersion = config.asset_version;

  var bundleNames = _.keys(bundles);

  var startTime = new Date();

  async.forEachSeries(bundleNames, function(bundleFile, cb) {
    console.log(('Creating bundle: ' + bundleFile).green);

    var fileBaseName = path.join(outputDirectory, bundleFile);

    var bundleStartTime;

    var manifestLog = {};

    async.waterfall([
      function(cb) {
        bundleStartTime = new Date();
        cb();
      },
      function(cb) {
        mapFiles(loadPaths, bundles[bundleFile], cb);
      },
      function(files, cb) {
        async.parallel([
          function(cb) {
            concatenateFiles(files, function(err, output) {
              if (err) {
                return cb(err);
              }

              var basename = bundleFile + "-uncompressed";
              writeFileWithMD5Name(assetVersion, manifestLog, outputDirectory, basename, output, cb);
            });
          },
          // function(cb) {
          //   uglifyFiles(files, uglifyOptions, function(err, output) {
          //     if (err) {
          //       return cb(err);
          //     }
          //
          //     var basename = bundleFile;
          //     writeFileWithMD5Name(assetVersion, manifestLog, outputDirectory, basename, output, cb);
          //   });
          // }
        ], function(err) {
          if (err) {
            return cb(err);
          }

          cb();
        });
      },
      // add the files to the manifest
      function(cb) {
        var manifestPath = path.join(outputDirectory, 'manifest.yml');

        var manifest = fs.readFileSync(manifestPath, 'utf8');
        manifest = yaml.safeLoad(manifest);

        var fileCount = 0;

        _.each(manifestLog, function(md5Name, shortName) {
          fileCount += 1;
          manifest[shortName] = md5Name;
        });

        console.log("Adding " + fileCount + "files to the manifest.yml");
        manifest = yaml.safeDump(manifest);
        console.log('manifest', manifest);
        fs.writeFile(manifestPath, manifest, { encoding: 'utf8' }, function(err) {
          if (err) {
            return cb(err)
          }

          cb();
        });
      },
      function(cb) {
        endTime = new Date();
        console.log("Completed in: " + ((new Date() - bundleStartTime) / 1000) + "sec");
        cb();
      }
    ], cb);
  }, function(err) {
    if (err) {
      console.error('Error compressing!'.red);
    }

    console.log('Done! compressing all bundles'.green);
    console.log('Total time: ' + ((new Date() - startTime) / 1000) + "sec");
  });
};