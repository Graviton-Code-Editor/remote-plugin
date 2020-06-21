
const fs = require("fs")
const { join, basename, dirname } = require("path")
const hyperswarm = require('hyperswarm')
const { createHash, randomBytes } = require('crypto')
const { encrypt, decrypt } = require("strong-cryptor")
const shortid = require("shortid")
console.log(decrypt)

const joinRoom = (API,room,password, username = Math.random()) => {
	const { puffin } = API
		
	let userid = shortid.generate()
	
	const emitter = new puffin.state({
		me:{
			username,
			userid
		},
		users: {
		
		}
	})
	
	const swarm = hyperswarm()
	const topic = createHash('sha256')
		.update(room)
		.digest()
	
	swarm.join(topic, {
		lookup: true, 
		announce: true 
	})
	
	let allSockets = []
	
	swarm.on('connection', (socket, details) => {
		handleData(socket,emitter,password)
		allSockets.push(socket)
		emitter.emit('userFound')
		socket.on("error", err =>{
			console.log(err)
			if( err ){
				emitter.emit('err',err)
				emitter.emit('userLeft',err)
			}
		})
		emitter.on("data", ({ type, content}) => {
			emitter.emit(type,content)
		})
		emitter.emit('message',{
			type: 'identifyUser',
			content:{
				username,
				userid
			}
		})
		emitter.on('identifyUser',({ username, userird }) => {
			const usernameExists = emitter.data.users[userird] !== undefined
			emitter.data.users[userird] = {
				username,
				socket
			}
			if(!usernameExists){
				emitter.emit('userIdentified',{
					username,
					userird
				})
			}
		})
	})
	emitter.on('message',data =>{
		const computedData = {
			...data,
			username,
			userid
		}
		const msg = JSON.stringify(data)
		if(data.type == 'identifyUser'){
			allSockets.map( socket => {
				send(socket,msg, password)
			})
		}else{
			Object.keys(emitter.data.users).map( userid => {
				const { socket } = emitter.data.users[userid]
				send(socket, msg, password)
			})
		}
	})
	return emitter
}

function handleData(socket, emitter,password){
	let previousPacketContent = ""
	socket.on('data', data => {
		if( data && typeof data == "object" ){
			console.log(Buffer.from(data))
			let msg = Buffer.from(data).toString()
			console.log(msg)
			let error = false
			try{
				
			}catch(err){
				error = err
			}
			if( !error ){
				const { i, t ,d } = JSON.parse(decrypt(msg, password))
				if(i < t){
					previousPacketContent += d
				}
				if(i === t-1){
					console.log(previousPacketContent)
					emitter.emit('data',JSON.parse(previousPacketContent))
					previousPacketContent = ""
				}
			}
		}
	})
}

const send = (socket, data, password) => {
	const splitedData = data.match(/.{1,500}/g)
	splitedData.map( (d,i,t) => {
		const packet = {
			i,
			t:t.length,
			d
		}
		console.log(packet)
		socket.write(encrypt(JSON.stringify(packet),password))
	})
}

function entry(API){
	const { StatusBarItem, ContextMenu } = API
	new StatusBarItem({
		label: 'Remote',
		action(e){
			new ContextMenu({
				parent: e.target,
				list:[
					{
						label: 'Join',
						action: async function(){
							const { room, password, username } = await askForConfig(API) 
							const emitter = joinRoom(API, room, password, username)
							handleEvents(emitter,API)
							createSidePanel(emitter,API)
						}
					}
				],
				event: e
			})
		}
	})
}

function handleEvents(emitter,API){
	const { RunningConfig } = API
	emitter.on('userFound', async () => {
		console.log(`User found in room:`)
	})
	emitter.on('info', data => {
		console.log(data)
	})
	emitter.on('userLeft', async () => {
		console.log('A user left the room!')
	})
	emitter.on('listFolder', async (folderPath) => {
		fs.readdir(folderPath,(err, list)=>{
			const computedItems = list.map( item => {
				const directory = join(folderPath,item)
				return {
					name: item,
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
	RunningConfig.on('addFolderToRunningWorkspace', ({ folderPath }) => {
		emitter.emit('message',{
			type: 'openedFolder',
			content: folderPath
		})
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
				emitter.on('userIdentified', async ({ username }) => {
					const user = puffin.element`<li>${username}</li>`
					puffin.render(user,this.querySelector("#users"))
				})
				emitter.on('openedFolder', async (folderPath) => {
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
					puffin.render(remoteExplorer,this.querySelector("#projects"))
				})
			}
			return puffin.element`
				<div mounted="${mounted}">
					<div id="users">
						<li>${emitter.data.me.username}(you)</li>
					</div>
					<div id="projects"/>
				</div>
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
			let itemsList = []
			itemsList = folderItems.map( ({ name, isFolder}) => {
				if(isFolder){
					let itemOpened = false
					const itemData = {
						label: name,
						action: async function(e,{ setItems }){
							if( isFolder ){
								if( !itemOpened) {
									const directory = join(folderPath,name)
									const items = await getItemsInFolder(emitter,directory,API)
									setItems(items)
								}
							}
							itemOpened = !itemOpened
						},
						items:[]
					}
					return itemData
				}
			}).filter(Boolean)
			folderItems.map( ({ name, isFolder }) => {
				if(!isFolder) {
					const itemData = {
						label: name,
						action: async function(e){
							if( !isFolder ){
							}
						}
					}
					itemsList.push(itemData)
				}
			})
			resolve(itemsList)
		})
	})
}

const askForConfig = ({ puffin, Dialog }) => {
	return new Promise((resolve, reject)=>{
		const dialog = new Dialog({
			title: 'Config',
			component(){
				return puffin.element`
					<div>
						<input placeHolder="public" id="room"/>
						<input placeHolder="Marc" id="username"/>
						<input type="password" id="password"/>
					</div>
				`
			},
			buttons:[
				{
					label: 'Connect',
					action(){
						const room = document.getElementById('room').value || 'public'
						const username = document.getElementById('username').value 
						const password = document.getElementById('password').value.repeat(32).substring(0,32)
						resolve({
							room,
							username,
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