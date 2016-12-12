# ikernel

Prototyping a javascript kernel for fun and demonstration

:warning: this is just a prototype

## Installation

1. Clone this repository
2. `cd` to the repo
3. `npm install`
4. create a kernelspec by hand for ikernel:

```
$ cat /Users/kylek/Library/Jupyter/kernels/ikernel/kernel.json
{
  "argv": [
    "node",
    "/Users/kylek/code/src/github.com/rgbkrk/ikernel",
    "{connection_file}"
  ],
  "display_name": "ikernel (Node.js)",
  "language": "javascript"
}
```

You'll want to use your own paths. Good luck!
