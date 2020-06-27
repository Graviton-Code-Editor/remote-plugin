
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
		})
		emitter.on('data', ({ type, content, username: peerName, usercolor: peerColor, userid: peerId }) => {
			emitter.emit(type,{
				...content,
				senderUsername: peerName,
				senderUsercolor: peerColor,
				senderUserid: peerId
			})
		})
		emitter.emit('message',{
			type: 'identifyUser',
			content:{
				username,
				userid,
				usercolor
			}
		})
		emitter.on('identifyUser',({ username, senderUserid }) => {
			const usernameExists = emitter.data.users[senderUserid] !== undefined
			emitter.data.users[senderUserid] = {
				username,
				usercolor,
				socket
			}
			if(!usernameExists){
				emitter.emit('userIdentified',{
					username,
					userird: senderUserid,
					usercolor
				})
			}
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
					if( user !== username ) send(emitter,socket, msg, username, password)
				})
			}else{ //Send to all identified peers
				Object.keys(emitter.data.users).map( userid => {
					const { socket, username:user } = emitter.data.users[userid]
					if( user !== username ) send(emitter,socket, msg, username, password)
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
			if( user !== username ) send(socket, msg, username, password)
			emitter.emit('userDisconnected',{ username: user, userid })
			delete emitter.data.users[userid]
		})
	})
	emitter.emit('connectedToRoom',{
		room,
		username
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
	const { puffin, StatusBarItem, ContextMenu, Notification } = API 
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
						label: 'Close',
						action: async function(){
							if(emitter) emitter.emit('disconnect')
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
	new SidePanel({
		icon(){
			return  puffin.element`
				<b style="color: var(--textColor)">RC</b>
			`
		},
		panel(){
			function mounted(){
				emitter.on('userIdentified', ({ username, usercolor }) => {
					function userMounted(){
						emitter.on('userDisconnected', ({ username: disconnectedUsername }) => {
							if( username === disconnectedUsername ){
								this.remove()
							}
						})
					}
					const user = new Explorer({
						items:[
							{
								label:  username,
								mounted: userMounted,
								decorator:{
									label: '',
									background: usercolor
								}
							}
						]
					})
					puffin.render(user,this.querySelector("#users"))
				})
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
				emitter.on('connectedToRoom',({ room, username })=>{
					const youUser = new Explorer({
						items:[
							{
								label:  emitter.data.me.username,
								decorator:{
									label: 'You',
									background: 'var(--buttonBackground)'
								}
							}
						]
					})
					puffin.render(youUser, this.children[0])
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
			userids:[useridServer],
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