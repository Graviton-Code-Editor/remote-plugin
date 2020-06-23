
const fs = require('fs')
const { join, basename, dirname, extname } = require("path")
const hyperswarm = require('hyperswarm')
const { createHash, randomBytes } = require('crypto')
const { encrypt, decrypt } = require('strong-cryptor')
const shortid = require('shortid')

let globalEmitter

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
				const { socket, username:user } = emitter.data.users[userid]
				if( user !== username ) send(socket, msg, password)
			})
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
			if( user !== username ) send(socket, msg, password)
			emitter.emit('userDisconnected',{ username: user, userid })
			delete emitter.data.users[userid]
		})
		
	})
	return emitter
}

function handleData(socket, emitter,password){
	let packets = []
	socket.on('data', data => {
		if( data && typeof data == "object" ){
			let msg = Buffer.from(data).toString().split("__")[0]
			let error = false
			try{
				JSON.parse(msg)
				const { d } = JSON.parse(msg)
				decrypt(d, password)
			}catch(err){
				error = err
				console.log(err)
			}
			if( !error ){
				const { i, t ,d, id } = JSON.parse(msg)
				if(!getPacket(packets,id)){
					packets.push({
						id,
						t,
						parts: {}
					})
				}
				if(i < t){
					const packet = getPacket(packets,id)
					packet.parts[i] = decrypt(d, password)
					console.log(` ${i+1}/${t} <--`,[packet.parts[i]])
				}
				if(Object.keys(getPacket(packets,id).parts).length === t){
					let packet = getPacket(packets,id)
					let computedData = ""
					for(let c = 0;c<t;c++){
						computedData += packet.parts[c]
					}
					console.log(`RECEIVED: ${t}/${t} ##`,[computedData])
					emitter.emit('data',JSON.parse(computedData))
					removePacket(packets,id)
				}
			}
		}
	})
}

const removePacket = (packets,idd) => {
	let where 
	packets.find(({id},i) => {
		if(id === id) where = i
	})
	packets.splice(where,1)
}

const getPacket = (packets,idd) => {
	return packets.find(({id}) => {
		return id === idd
	})
}

const send = (socket, data, password) => {
	const splitedData = data.match(/.{1,800}/g)
	const id = createHash('sha256')
		.update(splitedData[0])
		.digest().toString()
	splitedData.map( (d,i,t) => {
		console.log(`${i+1}/${t.length} -->`,splitedData)
		const packet = {
			i,
			t:t.length,
			d:encrypt(d,password),
			id
		}
		socket.write(`${JSON.stringify(packet)}__`)
	})
	console.log(`SENT: ${splitedData.length}/${splitedData.length} ##`,[splitedData])
}

function entry(API){
	const { StatusBarItem, ContextMenu, Notification } = API
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
							globalEmitter = emitter
							handleEvents(emitter,API)
							createSidePanel(emitter,API)
							new Notification({
								title: `Joined #${room} as ${username}`,
								content: ''
							})
						}
					},
					{
						label: 'Close',
						action: async function(){
							if(globalEmitter) globalEmitter.emit('disconnect')
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
	emitter.on('info', data => {
		console.log(data)
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
					function userMounted(){
						emitter.on('userDisconnected', ({ username: disconnectedUsername }) => {
							if( username === disconnectedUsername ){
								this.remove()
							}
						})
					}
					const user = puffin.element`<li mounted="${userMounted}">${username}</li>`
					puffin.render(user,this.querySelector("#users"))
				})
				emitter.on('openedFolder', async (folderPath) => {
					let itemOpened = false
					const remoteExplorer = new Explorer({
						items:[
							{
								label: basename(folderPath),
								items: [],
								icon:'folder.closed',
								action: async function(e,{ setIcon, setItems }){
									if( !itemOpened ){
										const items = await getItemsInFolder(emitter,folderPath,API)
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
					<div id="users">
						<li>${emitter.data.me.username}(you)</li>
					</div>
					<div id="projects"/>
				</div>
			`
		}
	})
}

const getExtension = path => extname(path).split('.')[1]

const getItemsInFolder = async (emitter,folderPath,API) => {
	const { puffin, SidePanel, Explorer, RunningConfig } = API
	return new Promise((resolve, reject) => {
		emitter.emit('message',{
			type: 'listFolder',
			content: folderPath
		})
		emitter.on('returnListFolder',({ folderPath: returnedFolderPath, folderItems })=>{
			if( folderPath === returnedFolderPath ){
				let itemsList = []
				itemsList = folderItems.map( ({ name, isFolder}) => {
					if(isFolder){
						let itemOpened = false
						const itemData = {
							label: name,
							icon: 'folder.closed',
							action: async function(e,{ setIcon, setItems }){
								if( isFolder ){
									if( !itemOpened) {
										const directory = join(folderPath,name)
										const items = await getItemsInFolder(emitter,directory,API)
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
				folderItems.map( ({ name, isFolder }) => {
					if(!isFolder) {
						const directory = join(folderPath,name)
						const itemData = {
							label: name,
							icon: `${getExtension(directory)}.lang`,
							action: async function(e){
								if( !isFolder ){
									//
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

const askForConfig = ({ puffin, Dialog, drac }) => {
	return new Promise((resolve, reject)=>{
		const dialog = new Dialog({
			title: 'Login',
			height: '270px',
			component(){
				const styleWrapper = puffin.style`
					& {
						display: flex;
						flex-direction: column;
					}
					& > div {
						display: flex;
						flex: 1;
					}
					& > div label {
						width: 120px;
						height: 100%;
						margin: auto 0;
					}
					& > div input {
						flex: 1;
						max-width: 60%;
					}
				`
				return puffin.element({
					components:{
						Input: drac.Input
					}
				})`
					<div class="${styleWrapper}">
						<div>
							<label>Room</label> 
							<Input placeHolder="CodeParty" id="room"/>
						</div>
						<div>
							<label>Username</label> 
							<Input placeHolder="Superman" id="username"/>
						</div>
						<div>
							<label>Password</label> 
							<Input type="password" id="password"/>
						</div>
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