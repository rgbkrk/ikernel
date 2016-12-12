const fs = require('fs')
const vm = require('vm')
const path = require('path')

const jmp = require('jmp')
const Rx = require('rxjs/Rx')
const _ = require('lodash')

const jupyterPaths = require('jupyter-paths')

const IOPUB = 'iopub';
const STDIN = 'stdin';
const SHELL = 'shell';
const CONTROL = 'control';

const DEALER = 'dealer';
const SUB = 'sub';

const ROUTER = 'router';
const PUB = 'pub';

const ZMQType = {
  frontend: {
    iopub: SUB,
    stdin: DEALER,
    shell: DEALER,
    control: DEALER,
  },
  backend: {
    iopub: PUB,
    stdin: ROUTER,
    shell: ROUTER,
    control: ROUTER,
  }
}

/**
 * read a connection file and return a promise
 * @param  {[type]} file [description]
 * @return {[type]}      [description]
 */
function readConnectionFile(file) {
  return new Promise((resolve, reject) => {
    fs.readFile(file, (err, data) => {
      if (err) {
        reject(err)
        return
      }
      try {
        connectionData = JSON.parse(data)

        const requiredKeys = [
          "signature_scheme", "key", "shell_port", "hb_port", "stdin_port",
          "transport", "control_port", "ip", "iopub_port"
        ]

        if(_.every(requiredKeys, _.partial(_.has, connectionData))) {
          resolve(connectionData)
        }
        reject(new Error("Missing keys in connection file"))
      } catch (err) {
        reject(err)
      }
    })
  })
}

function formConnectionString(config, channel) {
  const portDelimiter = config.transport === 'tcp' ? ':' : '-';
  const port = config[channel + '_port'];
  if (! port) {
    throw new Error(`Port not found for channel "${channel}"`);
  }
  return `${config.transport}://${config.ip}${portDelimiter}${port}`;
}

function createSocket(channel, identity, config) {
  const zmqType = ZMQType.backend[channel];
  const scheme = config.signature_scheme.slice('hmac-'.length);
  const socket = new jmp.Socket(zmqType, scheme, config.key);
  socket.identity = identity;
  socket.connect(formConnectionString(config, channel));
  return socket;
}

function createSession() {
  // Later we'll have this create a display_data object
  const hookedDisplay = console.log.bind(console)

  var sandbox = vm.createContext(
    Object.assign(
      { display: hookedDisplay },
      global
    )
  )

  return sandbox
}


// Take in a connection file
// Create the sockets
// Set up the sandbox

readConnectionFile(
  path.join(jupyterPaths.runtimeDir(), 'kernel-93838.json')
).then(console.log)
