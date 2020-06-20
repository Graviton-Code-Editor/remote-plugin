
const fs = require("fs")
const { join, basename, dirname } = require("path")
const hyperswarm = require('hyperswarm')
const { createHash, randomBytes } = require('crypto')
const { encrypt, decrypt } = require("strong-cryptor")

const executeServer = (API,room,password) => {
	const { puffin } = API

	const emitter = new puffin.state({})

	const swarm = hyperswarm()
	const topic = createHash('sha256')
		.update(room)
		.digest()

	swarm.join(topic, {
		lookup: true, 
		announce: true 
	})
	
	swarm.on('connection', (socket, details) => {
		socket.on("error", err =>{
			console.log(err)
			if( err ){
				emitter.emit('err',err)
				emitter.emit('userLeft',err)
			}
		})
		socket.on("data", data =>{
			console.log(data)
			if( data && typeof data == "object"){
				const msg = Buffer.from(data).toString()
				let err = false
				try{
					const { type, content} = JSON.parse(msg)
				}catch(error){
					err = error
				}
				if( !err ){
					const { type, content} = JSON.parse(msg)
					emitter.emit(type,content)
				}
			}
		})
		
		emitter.on('message',data =>{
			socket.write(JSON.stringify(data))
		})
		
	})

	return emitter
}

function entry(API){
	const { StatusBarItem, RunningConfig, Explorer, SidePanel, puffin, Tab } = API
	new StatusBarItem({
		label: 'server',
		action: async function(){
			const { room, password } = await askForConfig(API) 
			const emitter = executeServer(API,room,password)
			emitter.on('userFound', async ({ type}) => {
				console.log(`User found in room: '${room}'`)
			})
			emitter.on('info', (a) => {
				console.log(a)
			})
			emitter.on('userLeft', async ({ type}) => {
				console.log('A user left the room!')
			})
			emitter.on('listFolder', async (folderPath) => {
				fs.readdir(folderPath,(err, list)=>{
					const computedItems = list.map( item => {
						const directory = join(folderPath,item)
						return {
							name: item,
							directory,
							isFolder: fs.lstatSync(directory).isDirectory()
						}
					})
					emitter.emit('message',{
						type: 'returnListFolder',
						content:{
							folderPath,
							folderItems: computedItems
						}
					})
				})
			})
			emitter.on('err', async (err) => {
				console.log(err)
			})
			RunningConfig.on('addFolderToRunningWorkspace', ({ folderPath }) => {
				console.log("EMITTED")
				emitter.emit('message',{
					type: 'openedFolder',
					content: folderPath
				})
			})
			console.log(()=>{
				emitter.emit('message', { 
					type: 'test1',
					content: { 
						message: 'Hello!'
					}
				})
			})
			new StatusBarItem({
				label: 'stop',
				action(){
					emitter.emit('close')
				}
			})
		}
	})
	new StatusBarItem({
		label: 'client',
		action: async function(){
			const { room, password } = await askForConfig(API) 
			const emitter = executeServer(API,room,password)
			emitter.on('userFound', async ({ type}) => {
				console.log(`User found in room: '${room}'`)
			})
			emitter.on('err', async (err) => {
				console.log(err)
			})
			emitter.on('info', (a) => {
				console.log(a)
			})
			emitter.on('test1', ({ message }) => {
				console.log('message: ', message)
			})
			new StatusBarItem({
				label: 'stop',
				action(){
					emitter.emit('close')
				}
			})
			createSidePanel(emitter,API)
		}
	})
}


const createSidePanel = (emitter,API) => {
	const { puffin, SidePanel, Explorer, RunningConfig } = API
	new SidePanel({
		icon(){
			return  puffin.element`
				<i>RC</i>
			`
		},
		panel(){
			function mounted(){
				emitter.on('openedFolder', async (folderPath) => {
					console.log("I CONFIRM")
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
		emitter.emit('message',{
			type: 'listFolder',
			content: folderPath
		})
		emitter.on('returnListFolder',({ folderPath, folderItems })=>{
			resolve(folderItems.map( ({ directory, name, isFolder}) => {
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
							
							
						}
						itemOpened = !itemOpened
					}
				}
				if(isFolder){
					itemData.items = []
				}
				return itemData
			}))
		})
	})
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
						const room = document.getElementById('room').value || 'public'
						const password = document.getElementById('password').value.repeat(32).substring(0,32)
						resolve({
							room,
							password
						})
					}
				}
			]
		})
		dialog.launch()
	})
}


module.exports = { entry }