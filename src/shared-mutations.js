import { ipcMain, ipcRenderer } from "electron"

class SharedMutations {
  constructor(options, store) {
    this.options = options
    this.store = store
  }

  loadOptions() {
    if (!this.options.type) this.options.type = process.type === "renderer" ? "renderer" : "main"
    if (!this.options.ipcMain) this.options.ipcMain = ipcMain
    if (!this.options.ipcRenderer) this.options.ipcRenderer = ipcRenderer
    if (!this.options.storeName) this.options.storeName = "default"
    this.IPC_EVENT_CONNECT = "vuex-mutations-connect" + ":" + this.options.storeName
    this.IPC_EVENT_NOTIFY_MAIN = "vuex-mutations-notify-main" + ":" + this.options.storeName
    this.IPC_EVENT_NOTIFY_RENDERERS = "vuex-mutations-notify-renderers" + ":" + this.options.storeName
  }

  connect(payload) {
    this.options.ipcRenderer.send(this.IPC_EVENT_CONNECT, JSON.stringify(payload))
  }

  onConnect(handler) {
    this.options.ipcMain.on(this.IPC_EVENT_CONNECT, handler)
  }

  notifyMain(payload) {
    this.options.ipcRenderer.send(this.IPC_EVENT_NOTIFY_MAIN, JSON.stringify(payload))
  }

  onNotifyMain(handler) {
    this.options.ipcMain.on(this.IPC_EVENT_NOTIFY_MAIN, handler)
  }

  notifyRenderers(connections, payload) {
    Object.keys(connections).forEach((processId) => {
      connections[processId].send(this.IPC_EVENT_NOTIFY_RENDERERS, JSON.stringify(payload))
    })
  }

  onNotifyRenderers(handler) {
    this.options.ipcRenderer.on(this.IPC_EVENT_NOTIFY_RENDERERS, handler)
  }

  rendererProcessLogic() {
    // Connect renderer to main process
    this.connect()

    // Save original Vuex methods
    this.store.originalCommit = this.store.commit
    this.store.originalDispatch = this.store.dispatch

    // Don't use commit in renderer outside of actions
    this.store.commit = () => {
      throw new Error(`[Vuex Electron] Please, don't use direct commit's, use dispatch instead of this.`)
    }

    // Forward dispatch to main process
    this.store.dispatch = (type, payload) => {
      this.notifyMain({ type, payload })
    }

    // Subscribe on changes from main process and apply them
    this.onNotifyRenderers((event, { type, payload }) => {
      this.store.originalCommit(type, JSON.parse(payload))
    })
  }

  mainProcessLogic() {
    const connections = {}

    // Save new connection
    this.onConnect((event) => {
      const win = event.sender
      const winId = win.id

      connections[winId] = win

      // Remove connection when window is closed
      win.on("destroyed", () => {
        delete connections[winId]
      })
    })

    // Subscribe on changes from renderer processes
    this.onNotifyMain((event, { type, payload }) => {
      this.store.dispatch(type, JSON.parse(payload))
    })

    // Subscribe on changes from Vuex store
    this.store.subscribe((mutation) => {
      const { type, payload } = mutation

      // Forward changes to renderer processes
      this.notifyRenderers(connections, { type, payload })
    })
  }

  activatePlugin() {
    switch (this.options.type) {
      case "renderer":
        this.rendererProcessLogic()
        break
      case "main":
        this.mainProcessLogic()
        break
      default:
        throw new Error(`[Vuex Electron] Type should be "renderer" or "main".`)
    }
  }
}

export default (options = {}) => (store) => {
  const sharedMutations = new SharedMutations(options, store)

  sharedMutations.loadOptions()
  sharedMutations.activatePlugin()
}
