const fs = require('fs')
const vm = require('vm')
const path = require('path')
const util = require('util')

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

function createSubscriber(socket) {
  return Rx.Subscriber.create(messageObject => {
    socket.send(new jmp.Message(messageObject));
  }, err => {
    // We don't expect to send errors to the kernel
    console.error(err);
  }, () => {
    // tear it down, tear it *all* down
    socket.removeAllListeners();
    socket.close();
  });
}

function createObservable(socket) {
  return Rx.Observable.fromEvent(socket, 'message')
                   .publish()
                   .refCount();
}

function createSubject(socket) {
  return Rx.Subject.create(createSubscriber(socket),
                           createObservable(socket));
}

function createSubjects(sockets) {
  return _.mapValues(sockets, createSubject)
}

function createSocket(id, connectionInfo, channel) {
  const zmqType = ZMQType.backend[channel]
  const scheme = connectionInfo.signature_scheme.slice('hmac-'.length)
  const socket = new jmp.Socket(zmqType, scheme, connectionInfo.key)
  socket.identity = id
  socket.bind(formConnectionString(connectionInfo, channel))
  return socket
}

function createSockets(id, connectionInfo) {
  return [IOPUB, SHELL, STDIN, CONTROL].reduce((channels, channel) =>
    Object.assign({}, channels, { [channel]: createSocket(id, connectionInfo, channel) }),
    {}
  )
}

function createSession(connectionInfo) {
  const id = uuid.v4();
  const sockets = createSockets(id, connectionInfo)
  const channels = createSubjects(sockets)

  // All of our "session"
  let execution_count = 0;
  const sandbox = vm.createContext(
    Object.assign(
      {},
      // { display: hookedDisplay },
      { require },
      global
    )
  )

  channels[SHELL]
    .filter(msg => msg.header.msg_type === 'kernel_info_request')
    .subscribe(msg => {
      msg.respond(
        sockets[SHELL],
        'kernel_info_reply',
        {
          "protocol_version": "5.0",
          "implementation": "ijavascript",
          "implementation_version": "v0",
          "language_info": {
              "name": "javascript",
              "version": process.version,
              "mimetype": "application/javascript",
              "file_extension": ".js",
          },
          "banner": (
              "ikernel v0\n" +
              "https://github.com/nteract\n"
          ),
          "help_links": [{
              "text": "ikernel",
              "url": "https://github.com/nteract",
          }],
        },
        {}
      )
    })

    channels[SHELL]
      .filter(msg => msg.header.msg_type === 'is_complete_request')
      .subscribe(msg => {
        msg.respond(
          sockets[SHELL],
          'is_complete_reply',
          {
            status: 'complete',
          },
          {}
        )
      })

    channels[SHELL]
      .filter(msg => msg.header.msg_type === 'execute_request')
      .subscribe(msg => {
        execution_count = execution_count + 1
        const code = msg.content.code

        msg.respond(
          sockets[IOPUB],
          'execute_input',
          {
            code,
            execution_count,
          },
          {}
        )

        msg.respond(
          sockets[SHELL],
          'execute_reply',
          {
            status: 'ok',
            execution_count,
          },
          {}
        )

        msg.respond(
          sockets[IOPUB],
          'status',
          {
            execution_state: 'busy',
          },
          {}
        )

        // Our display is bound to the current message (as a parent)
        const display = function(data, options={}) {
          let messageType = 'display_data'
          const payload = {}
          if (options.raw) {
            payload.data = data
          } else {
            payload.data = { 'text/plain': util.inspect(data) }
          }

          if (options.display_id) {
            payload.transient = {
              display_id: options.display_id,
            }
          }

          if (options.update) {
            messageType = 'update_display_data'
          }

          msg.respond(
            sockets[IOPUB],
            messageType,
            payload,
            {}
          )
        }

        // We provide the function directly on the user's REPL
        sandbox.display = display;

        try {
          result = vm.runInContext(code, sandbox, {
            filename: '<ikernel>'
          })

          if(_.isUndefined(result)) {
            msg.respond(
              sockets[IOPUB],
              'execute_result',
              {
                execution_count,
                data: {}
              },
              {}
            )
          } else {
            msg.respond(
              sockets[IOPUB],
              'execute_result',
              {
                execution_count,
                data: {
                  'text/plain': util.inspect(result),
                }
              },
              {}
            )
          }

        } catch(err) {
          msg.respond(
            sockets[IOPUB],
            'error',
            {
              ename: err.name,
              evalue: err.message,
              traceback: err.stack && err.stack.split ? err.stack.split("\n") : null,
            },
            {}
          )
        }

        msg.respond(
          sockets[IOPUB],
          'status',
          {
            execution_state: 'idle',
          },
          {}
        )
      })
}


//
// Main entry point for our kernel, expects a connection file
//
const connectionFile = process.argv[2];
// TODO: Allow a --existing flag like this?
//   path.join(jupyterPaths.runtimeDir(), existingFile)
if (!connectionFile) {
  throw new Error("No connection file provided")
}

readConnectionFile(connectionFile)
  .then(createSession)
  .catch(err => console.error(err))
