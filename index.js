const fs = require('fs')
const vm = require('vm')
const path = require('path')

const uuid = require('uuid')

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

function formConnectionString(connectionInfo, channel) {
  const portDelimiter = connectionInfo.transport === 'tcp' ? ':' : '-'
  const port = connectionInfo[channel + '_port']
  if (! port) {
    throw new Error(`Port not found for channel "${channel}"`)
  }
  return `${connectionInfo.transport}://${connectionInfo.ip}${portDelimiter}${port}`
}

function createSubject(socket) {
  const subj = Subject.create(createSubscriber(socket),
                              createObservable(socket));
  return subj;
}

function createSocket(id, connectionInfo, channel) {
  const zmqType = ZMQType.backend[channel]
  const scheme = connectionInfo.signature_scheme.slice('hmac-'.length)
  const socket = new jmp.Socket(zmqType, scheme, connectionInfo.key)
  socket.identity = id
  socket.connect(formConnectionString(connectionInfo, channel))
  return socket
}

function createSockets(id, connectionInfo) {
  return [IOPUB, SHELL, STDIN, CONTROL].reduce((channels, channel) =>
    Object.assign({}, channels, { [channel]: createSocket(id, connectionInfo, channel) }),
    {}
  )
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

const connectionFile = process.argv[2];
if (!connectionFile) {
  throw new Error("No connection file provided")
}

// TODO: Allow a --existing flag like this?
//   path.join(jupyterPaths.runtimeDir(), existingFile)

readConnectionFile(
  connectionFile
).then((connectionInfo) => {
  console.log(connectionInfo)
  const id = uuid.v4();
  console.log('id: ', id)
  const channels = createSockets(id, connectionInfo)




  // Close down the channels
  _.forOwn(channels, (channel, channelName) => {
    channel.removeAllListeners()
    channel.close()
  })

}).catch(err => console.error(err))
