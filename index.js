const crypto = require('crypto')
const Swarm = require('discovery-swarm')
const defaults = require('dat-swarm-defaults')
const getPort = require('get-port')
const { encrypt, decrypt } = require("strong-cryptor")
const { basename, join, extname } = require("path")
const fs = require("fs")

let config = defaults({
	id: crypto.randomBytes(32),
	room: "graviton_live_test",
	password: "graviton".repeat(32).substring(0,32)
})

const peers = {}
let connSeq = 0

function send(message){
	const data = encrypt(JSON.stringify(message), config.password)
	for (let id in peers) {
		peers[id].conn.write(data) 
	}
}

const askUser = async () => {
	return;
	for (let id in peers) {
		peers[id].conn.write(JSON.stringify(data)) //SENDS tabs
	}
}

async function connect(config, puffin){
	const emitter = new puffin.state({})
	
	const sw = Swarm(config)
	const port = await getPort()
	sw.listen(port)
	sw.join(config.room)
	let myPeer 
	sw.on('connection', (conn, info) => {
		const seq = connSeq
		const peerId = info.id.toString('hex')
		if( !myPeer) {
			myPeer = peerId
		}
		if (info.initiator) {
			try {
				conn.setKeepAlive(true, 600)
			} catch (exception) {
				console.log('exception', exception)
			}
		}
		conn.on('data', data => {
			const content = JSON.parse(decrypt(data.toString(),config.password))
			emitter.emit('message',content)
		})
		conn.on('close', (a,b,c) => {
			if (peers[peerId].seq === seq) {
				delete peers[peerId]
			}
		})
		if (!peers[peerId]) {
			peers[peerId] = {}
		}
		peers[peerId].conn = conn
		peers[peerId].seq = seq
		connSeq++
	})
	return emitter
}

const askForConfig = ({puffin, Dialog }) => {
	return new Promise((resolve,reject)=>{
		const dialog = new Dialog({
			title: 'Config',
			component(){
				return puffin.element`
					<div>
						<input placeHolder="room" id="room"/>
						<input type="password" id="password"/>
					</div>
				`
			},
			buttons:[
				{
					label: 'Connect',
					action(){
						config.room = document.getElementById('room').value
						config.password = document.getElementById('password').value.repeat(32).substring(0,32)
						resolve()
					}
				}
			]
		})
		dialog.launch()
	})
}

const entry = (API) => {
	const { StatusBarItem, RunningConfig, Explorer, SidePanel, puffin, Tab } = API
	new StatusBarItem({
		label: 'server',
		action: async function(){
			await askForConfig(API)
			const emitter = await connect(config,puffin)
			RunningConfig.on('addFolderToRunningWorkspace', ({ folderPath }) => {
				send({
					type: 'openedFolder',
					folderPath
				})
			})
			emitter.on('message', async ({ type, filePath, folderPath, items}) => {
				switch(type){
					case 'listFolder':
						fs.readdir(folderPath,(err,items) => {
							const computedItems = items.map( item => {
								const directory = join(folderPath,item)
								return {
									name: item,
									directory,
									isFolder: fs.lstatSync(directory).isDirectory()
								}
							})
							send({
								type: 'returnListFolder',
								folderPath,
								items: computedItems
							})
						})
						break;
					case 'getFileContent':
						fs.readFile(filePath,'UTF8',(err, content) => {
							send({
								type: 'returnGetFileContent',
								filePath,
								fileData: content
							})
						})
						break;
				}
			})
		}
	})
	new StatusBarItem({
		label: 'client',
		action: async function(){
			await askForConfig(API)
			const emitter = await connect(config,puffin)
			createSidePanel(emitter,API)
		}
	})
	
}


const createSidePanel = (emitter,API) => {
	const { puffin, SidePanel, Explorer, RunningConfig } = API
	new SidePanel({
		icon(){
			return  puffin.element`
				<i>LC</i>
			`
		},
		panel(){
			
			function mounted(){
				emitter.on('message', ({ type, folderPath }) => {
					switch(type){
						case 'openedFolder':
							let itemOpened = false
							const remoteExplorer = new Explorer({
								items:[
									{
										label: basename(folderPath),
										items: [],
										action: async function(e,{ setItems }){
											if( !itemOpened ){
												const items = await getItemsInFolder(emitter,folderPath,API)
												setItems(items)
											}
											itemOpened = !itemOpened
										}
									}
								]
							})
							puffin.render(remoteExplorer,this)
							break;
					}
				})
			}
			return puffin.element`
				<div mounted="${mounted}"/>
			`
		}
	})
}

const getItemsInFolder = async (emitter,folderPath,API) => {
	const { puffin, SidePanel, Explorer, RunningConfig } = API
	return new Promise((resolve, reject) => {
		send({
			type: 'listFolder',
			folderPath
		})
		emitter.on('message',({ type, folderPath, items}) => {
			if( type === 'returnListFolder'){
				resolve(items.map( ({ directory, name, isFolder}) => {
					let itemOpened = false
					const itemData = {
						label: name,
						action: async function(e,{ setItems }){
							if( isFolder ){
								if( !itemOpened) {
									const items = await getItemsInFolder(emitter,directory,API)
									setItems(items)
								}
							}else{
								const fileContent = await getFileContent(emitter,directory)
								createFileTab(directory, folderPath,fileContent, API)
							}
							itemOpened = !itemOpened
						}
					}
					if(isFolder){
						itemData.items = []
					}
					return itemData
				}))
			}
		})
	})
}

function getFormat(dir) {
	const array = extname(dir).split('.')
	return array ? array[array.length - 1] : path.basename(dir)
}

const createFileTab = (filePath, folderPath, value, API) => {
	const { puffin, SidePanel, Explorer, RunningConfig, PluginsRegistry, Tab, Editor } = API
	const { bodyElement, tabElement, tabState, isCancelled } = new Tab({
		isEditor: true,
		title: basename(filePath),
		directory: filePath,
		parentFolder: folderPath,
	})
	if (!isCancelled) {
		const fileExtension = getFormat(basename(filePath))
		new Editor({
			language: fileExtension,
			value,
			theme: 'Night',
			bodyElement,
			tabElement,
			tabState,
			directory: filePath,
		})
		tabState.on('focusedItem', () => target.scrollIntoView())
	}
}

const getFileContent = async (emitter, filePath) => {
	return new Promise((resolve, reject) => {
		send({
			type: 'getFileContent',
			filePath
		})
		emitter.on('message',({ type, filePath, fileData }) => {
			if( type === 'returnGetFileContent'){
				resolve(fileData)
			}
		})
	})
}

module.exports = {
	entry
}
