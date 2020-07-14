
const fs = require('fs')
const { join, basename, dirname, extname, normalize } = require("path")
const hyperswarm = require('hyperswarm')
const { createHash, randomBytes } = require('crypto')
const { encrypt, decrypt } = require('strong-cryptor')
const shortid = require('shortid')
const randomColorRGB = require('random-color-rgb')

const listFolder = require('./src/events/list_folder')
const tabCreated = require('./src/events/tab_created')
const readFile = require('./src/events/read_file')
const userJoined = require('./src/events/user_joined')
const configDialog = require('./src/config_dialog')
const createTabEditor = require('./src/tab_editor')

const { sanitizePath, getExtension } = require('./src/utils')

const PACKET_DELAY_REQUEST = 1000

const joinRoom = ({
	emitter,
	API, 
	room, 
	password, 
	username
}) => {
	const { puffin } = API
	const userid = shortid.generate() //Generate user's ID
	const usercolor = randomColorRGB({min: 70}) //Generate user's color
	const allSockets = []
	emitter.data = {
		room,
		me:{
			username,
			userid
		},
		users: {}
	}
	const swarm = hyperswarm()
	const topic = createHash('sha256')
		.update(room)
		.digest()
	swarm.join(topic, {
		lookup: true, 
		announce: true 
	})
	swarm.on('connection', (socket, details) => {
		handleData(socket,emitter,username,password)
		allSockets.push(socket)
		emitter.emit('userFound')
		socket.on('error', err =>{
			console.log(err)
			if( err ){
				emitter.emit('err',err)
				emitter.emit('userLeft',err)
			}
			userDisconnnected(socket)
		})
		socket.on('disconnect', err =>{
			userDisconnnected(socket)
		})
		emitter.emit('message',{
			type: 'identifyUser',
			content:{
				username,
				userid,
				usercolor
			}
		})
		emitter.on('identifyUser',({ username, senderUserid, usercolor }) => {
			const usernameExists = emitter.data.users[senderUserid] !== undefined
			emitter.data.users[senderUserid] = {
				username,
				usercolor,
				socket
			}
			if(!usernameExists){
				emitter.emit('userIdentified',{
					username,
					userid: senderUserid,
					usercolor
				})
			}
		})
	})
	const userDisconnnected = peerSocket => {
		Object.keys(emitter.data.users).map( userid => {
			const { socket: userSocket, username: user } = emitter.data.users[userid]
			if( peerSocket === userSocket){
				emitter.emit('userDisconnected',{ 
					username: user, 
					userid 
				})
			}
		})
	}
	emitter.on('data', ({ type, content, username: peerName, usercolor: peerColor, userid: peerId }) => {
		emitter.emit(type,{
			...content,
			senderUsername: peerName,
			senderUsercolor: peerColor,
			senderUserid: peerId
		})
	})
	emitter.on('message',data =>{
		const computedData = {
			...data,
			username,
			userid,
			usercolor
		}
		const msg = JSON.stringify(computedData)
		if(data.type == 'identifyUser'){
			allSockets.map( socket => {
				send(emitter,socket,msg, username, password)
			})
		}else{
			if(data.userids){ //Send to specific peers
				data.userids.map( userid => {
					const { socket, username:user } = emitter.data.users[userid]
					if( user !== username ) send(emitter, socket, msg, username, password)
				})
			}else{ //Send to all identified peers
				Object.keys(emitter.data.users).map( userid => {
					const { socket, username:user } = emitter.data.users[userid]
					if( user !== username ) send(emitter, socket, msg, username, password)
				})
			}
		}
	})
	emitter.on('disconnect',() => {
		const data = {
			type: 'userDisconnected',
			content:{
				username,
				userid
			},
			username,
			userid
		}
		const msg = JSON.stringify(data)
		Object.keys(emitter.data.users).map( userid => {
			const { socket, username: user } = emitter.data.users[userid]
			if( user !== username ) send(emitter, socket, msg, username, password)
			emitter.emit('userDisconnected',{ username: user, userid })
			delete emitter.data.users[userid]
		})
	})
	emitter.emit('connectedToRoom',{
		room,
		username,
		userid,
		usercolor
	})
}

function handleData(socket, emitter,username, password){
	const packets = []
	const closedPackets = []
	socket.on('data', data => {
		if( data && typeof data == "object" ){
			let msg = Buffer.from(data).toString().split("__")[0]
			let error = false
			try{
				const { d } = JSON.parse(msg)
			}catch(err){
				error = err
			}
			if( !error ){
				const { i, t ,d, id, username: peerName } = JSON.parse(msg)
				if(peerName === username) return
				if(!getPacket(packets,id)){
					packets.push({
						id,
						t,
						parts: {}
					})
				}
				if(i < t){
					const packet = getPacket(packets,id)
					if(packet.parts[i]) return
					packet.parts[i] = d
				}
				if(Object.keys(getPacket(packets,id).parts).length === t){
					if(closedPackets.includes(id)) return
					let packet = getPacket(packets,id)
					let computedData = ""
					for(let c = 0;c<t;c++){
						computedData += packet.parts[c]
					}
					emitter.emit('data',JSON.parse(decrypt(computedData, password)))
					removePacket(packets,closedPackets,id)
				}else{
					setTimeout(()=>{
						const packet = getPacket(packets,id)
						if(packet && !closedPackets.includes(id)){
							const packetsNotFound = []
							for(let c = 0;c<t;c++){
								if(!packet.parts[c]){
									packetsNotFound.push(c)
								}
							}
							emitter.emit('message',{
								type: 'requestPacket',
								content: {
									id,
									numbers: packetsNotFound,
									t
								}
							})
						}
					},PACKET_DELAY_REQUEST)
				}
			}
		}
	})
}

const removePacket = (packets,closedPackets,idd) => {
	let where 
	packets.find(({id},i) => {
		if(id === id) {
			closedPackets.push(id)
			where = i
		}
	})
	packets.splice(where,1)
}

const getPacket = (packets,idd) => {
	return packets.find(({id}) => {
		return id === idd
	})
}

const send = (emitter, socket, data, username, password) => {
	const splitedData = encrypt(data,password).match(/.{1,1100}/g)
	const id = createHash('sha256')
		.update(splitedData[0])
		.digest().toString()
	emitter.on('requestPacket',({ id:idd, numbers,t }) => {
		if(idd === id){
			numbers.forEach(n => {
				sendPacket(splitedData[n],n,Array(t))
			})
		}
	})
	const sendPacket = (d,i,t) => {
		const packet = {
			i,
			t:t.length,
			d,
			id,
			username
		}
		socket.write(`${JSON.stringify(packet)}__`)
	}
	splitedData.map(sendPacket)
}

function entry(API){
	const { puffin, StatusBarItem, ContextMenu, Notification, RunningConfig } = API 
	RunningConfig.on('allPluginsLoaded',function(){
		const emitter = new puffin.state({})
		createSidePanel(emitter,API)
		new StatusBarItem({
			label: 'Remote',
			action(e){
				new ContextMenu({
					parent: e.target,
					list:[
						{
							label: 'Join',
							action: async function(){
								const { room, password, username } = await configDialog(API) 
								joinRoom({
									emitter,
									API, 
									room, 
									password, 
									username
								})
								new Notification({
									title: `Joined #${room} as ${username}`,
									content: ''
								})
								handleEvents(emitter, API)
							}
						},
						{
							label: 'Disconnect',
							action(){
								emitter.emit('disconnect',{})
							}
						}
					],
					event: e
				})
			}
		})
	})
	
}

function handleEvents(emitter,API){
	const { RunningConfig } = API
	emitter.on('listFolder', async ({ folderPath }) => {
		listFolder({
			emitter,
			folderPath
		})
	})
	RunningConfig.on('aTabHasBeenCreated', ({ directory, client, instance }) => {
		tabCreated({
			emitter,
			directory,
			client,
			instance,
			...API
		})
	})
	emitter.on('getFileContent', async ({ filePath }) => {
		readFile({
			emitter,
			filePath
		})
	})
	emitter.on('userIdentified', async ({ username }) => {
		userJoined({
			room: emitter.data.room,
			username,
			...API
		})
	})
	RunningConfig.on('addFolderToRunningWorkspace', ({ folderPath }) => {
		emitter.emit('message',{
			type: 'openedFolder',
			content: {
				folderPath: sanitizePath(folderPath)
			}
		})
	})
}

const createSidePanel = (emitter,API) => {
	const { puffin, SidePanel, Explorer, RunningConfig } = API
	const iconStyle = puffin.style`
		& > * {
			stroke: var(--iconFill)
		}
	`
	new SidePanel({
		icon(){
			return  puffin.element`
				<svg class="${iconStyle}" width="38" height="28" viewBox="0 0 38 28" fill="none" xmlns="http://www.w3.org/2000/svg">
					<rect x="1" y="21" width="14" height="6" rx="2" stroke-width="3"/>
					<circle cx="7.69391" cy="13.7688" r="4.49565" stroke-width="3"/>
					<rect x="24" y="13" width="13" height="6" rx="2" stroke-width="3"/>
					<circle cx="30.3061" cy="5.49565" r="4.49565"stroke-width="3"/>
					<path d="M14.597 9.86821L17.2567 7.14069L19.6369 8.92586L22.6122 7.14069" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
				</svg>
			`
		},
		panel(){
			function mounted(){
				let activeUsers = {}
				const getCurrentUsers = () => {
					return Object.keys(activeUsers).map( userid => {
						const { username, usercolor, isMe } = activeUsers[userid]
						return {
							label:  username,
							decorator:{
								label: isMe? 'You': '',
								background: usercolor
							}
						}
					})
				}
				
				const usersExplorer = new Explorer({
					items:[
						{
							label:  'Users',
							decorator:{
								label: '0'
							},
							items: [],
							mounted({ setItems, setDecorator }){
								emitter.on('connectedToRoom',({ room, userid, username, usercolor })=>{
									activeUsers[userid] = {
										username,
										usercolor,
										isMe : true
									}
									const currentUsers = getCurrentUsers()
									setItems(currentUsers)
									setDecorator({
										label: Object.keys(currentUsers).length
									})
								})
								emitter.on('userIdentified', ({ userid, username, usercolor }) => {
									activeUsers[userid] = {
										username,
										usercolor,
										isMe : false
									}
									const currentUsers = getCurrentUsers()
									setItems(currentUsers)
									setDecorator({
										label: Object.keys(currentUsers).length
									})
								})
								emitter.on('userDisconnected', ({ userid, username, usercolor }) => {
									delete activeUsers[userid]
									const currentUsers = getCurrentUsers()
									setItems(currentUsers)
									setDecorator({
										label: Object.keys(currentUsers).length
									})
								})
								emitter.on('disconnect',()=>{
									delete activeUsers[emitter.data.me.userid]
									setDecorator({
										label: '0'
									})
									setItems([])
								})
							}
						}
					]
				})
				puffin.render(usersExplorer,this.querySelector("#users"))
				emitter.on('openedFolder', async ({ folderPath, senderUserid }) => {
					let itemOpened = false
					const remoteExplorer = new Explorer({
						items:[
							{
								label: basename(folderPath),
								items: [],
								icon:'folder.closed',
								action: async function(e,{ setIcon, setItems }){
									if( !itemOpened ){
										const items = await getItemsInFolder(emitter, folderPath, API, senderUserid)
										setItems(items)
										setIcon('folder.opened')
									}else{
										setIcon('folder.closed')
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
					<div id="users"/>
					<div id="projects"/>
				</div>
			`
		}
	})
}

const getItemsInFolder = async (emitter, folderPath, API, useridServer) => {
	const { puffin, SidePanel, Explorer, RunningConfig, Editor, Tab } = API
	return new Promise((resolve, reject) => {
		emitter.emit('message',{
			type: 'listFolder',
			userids: [useridServer],
			content: {
				folderPath
			}
		})
		emitter.on('returnListFolder',({ folderPath: returnedFolderPath, folderItems })=>{
			if( folderPath === returnedFolderPath ){
				let itemsList = []
				itemsList = folderItems.map(({ name, isFolder}) => {
					if(isFolder){
						let itemOpened = false
						const itemData = {
							label: name,
							icon: 'folder.closed',
							action: async function(e,{ setIcon, setItems }){
								if( isFolder ){
									if( !itemOpened) {
										const directory = sanitizePath(join(folderPath,name))
										const items = await getItemsInFolder(emitter,directory,API,useridServer)
										setItems(items)
										setIcon('folder.opened')
									}else{
										setIcon('folder.closed')
									}
								}
								itemOpened = !itemOpened
							},
							items:[]
						}
						return itemData
					}
				}).filter(Boolean)
				folderItems.map(({ name, isFolder }) => {
					if(!isFolder) {
						const directory = sanitizePath(join(folderPath,name))
						const itemData = {
							label: name,
							icon: `${getExtension(directory)}.lang`,
							action: async function(e){
								if( !isFolder ){
									createTabEditor({
										filePath: directory, 
										folderPath, 
										emitter, 
										...API
									})
								}
							}
						}
						itemsList.push(itemData)
					}
				})
				resolve(itemsList)
			}
		})
	})
}

module.exports = { entry }