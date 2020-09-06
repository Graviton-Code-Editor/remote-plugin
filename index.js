
const fs = require('fs')
const { join, basename, dirname, extname, normalize } = require("path")
const shortid = require('shortid')
const randomColorRGB = require('random-color-rgb')

const listFolder = require('./src/events/list_folder')
const tabCreated = require('./src/events/tab_created')
const readFile = require('./src/events/read_file')
const userJoined = require('./src/events/user_joined')
const configDialog = require('./src/config_dialog')
const createTabEditor = require('./src/tab_editor')

const { sanitizePath, getExtension } = require('./src/utils')

const WebSocket = require('ws')
const { createHash } = require('crypto')
const { Encryptor, Decryptor } = require('strong-cryptor')

class Instance {
	constructor({ emitter, room, username, password }){
		this.room = room
		this.username = username
		this.userid = shortid.generate()
		this.usercolor = randomColorRGB({min: 70})
		this.password = createHash('sha256').update(password).digest()
		this.emitter = emitter
		this.emitter.data = this
		this.conn = new WebSocket('ws://graviton-api.herokuapp.com/websockets')

		this.conn.onopen = () => {
			this.send('userJoin',{
				username: this.username
			})
			this.emitter.emit('instance/connected',{
				room: this.room,
				username: this.username,
				userid: this.userid,
				usercolor: this.usercolor
			})
		}

		this.conn.onerror = error => {
			this.emitter.emit('error', error)
		}

		this.conn.onmessage = e => {
			const { encrypted = true, userid, usercolor, username, type, data} = JSON.parse(e.data)
			const encryptor = new Decryptor({
				key: this.password
			})
			const decryptedData = encrypted ? encryptor.decrypt(data) : data

			this.emitter.emit(`room/${type}`, {
				...JSON.parse(decryptedData),
				senderUsername: username,
				senderUserid: userid,
				senderUsercolor: usercolor
			})
		}
		this.emitter.on('message', data => {
			this.send(data.type, data.content)
		})
		this.emitter.on('disconnect', data => {
			this.conn.close()
		})
	}
	send(eventName, data = {}){
		
		const encryptor = new Encryptor({
			key: this.password
		})

		const encryptedData = encryptor.encrypt(JSON.stringify(data))

		this.conn.send(JSON.stringify(
			{
				username: this.username,
				usercolor: this.usercolor,
				userid: this.userid,
				room: this.room,
				type: eventName,
				data: encryptedData,
				encrypted: true
			}
		))
	}
	on(eventName, args){
		return this.emitter.on(eventName, args)
	}
	waitToConnect(){
		return new Promise((res) => {
			this.on('instance/connected', () => res())
		})
	}
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
								
								const my_instance = new Instance({
									emitter,
									room, 
									password, 
									username
								})
								
								await my_instance.waitToConnect()
								
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
								emitter.emit('instance/disconnect',{})
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
	emitter.on('room/listFolder', async ({ folderPath }) => {
		listFolder({
			emitter,
			folderPath
		})
	})
	emitter.on('room/getFileContent', async ({ filePath }) => {
		readFile({
			emitter,
			filePath
		})
	})
	emitter.on('room/userJoin', async ({ senderUsername }) => {
		userJoined({
			room: emitter.data.room,
			username: senderUsername,
			...API
		})
	})
	emitter.on('room/welcome', async ({ users }) => {
		users.map(({ username, userid, usercolor }) => {
			if(userid === emitter.data.userid) return
			emitter.emit('room/userJoin',{
				senderUsername: username,
				senderUserid: userid,
				senderUsercolor: usercolor
			})
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
	RunningConfig.on('aTabHasBeenCreated', ({ directory, client, instance }) => {
		tabCreated({
			emitter,
			directory,
			client,
			instance,
			...API
		})
	})
}

const createSidePanel = (emitter,API) => {
	const { puffin, SidePanel, Explorer, FilesExplorer } = API
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
								emitter.on('instance/connected',({ room, userid, username, usercolor })=>{
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
									document.getElementById('room_name').innerText = `Room: ${room}`
								})
								emitter.on('room/userJoin', ({ senderUserid, senderUsername, senderUsercolor }) => {
									activeUsers[senderUserid] = {
										username: senderUsername,
										usercolor: senderUsercolor,
										isMe : false
									}
									const currentUsers = getCurrentUsers()
									setItems(currentUsers)
									setDecorator({
										label: Object.keys(currentUsers).length
									})
								})
								emitter.on('room/userDisconnected', ({ userid, username, usercolor }) => {
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

				emitter.on('room/openedFolder', async ({ folderPath, senderUserid }) => {
					new FilesExplorer(folderPath, folderPath, document.getElementById('explorer_panel'), 0, false, null, {
						provider: {
							decorator:{
								text: 'remote'
							},
							listDir: async function(path){
								return await getItemsInFolder(emitter, path, senderUserid)
							},
							isGitRepo(){
								return new Promise( res => res(false))
							},
							readFile: function (path) {
								return new Promise( async (res) => {
									
									emitter.on('room/returnGetFileContent',({
										filePath,
										fileContent
									}) => {
										if(filePath === sanitizePath(path)){
											res(fileContent)
										}
									})
									emitter.emit('message',{
										type: 'getFileContent',
										content: {
											filePath: sanitizePath(path)
										}
									})
								})
							}
						}
					})
				})
			}
			
			const wrapperStyle = puffin.style`
				& p {
					color: var(--textColor);
					font-size: 12px;
					margin: 2px 15px;
				}
			`
			
			return puffin.element`
				<div class="${wrapperStyle}"mounted="${mounted}">
					<p id="room_name">Room (disconnected) </p>
					<div id="users"/>
				</div>
			`
		}
	})
}

const getItemsInFolder = async (emitter, folderPath, useridServer) => {
	return new Promise(resolve => {
		emitter.emit('message',{
			type: 'listFolder',
			userids: [useridServer],
			content: {
				folderPath
			}
		})
		emitter.on('room/returnlistFolder',({ folderPath: returnedFolderPath, folderItems })=>{
			if( folderPath === returnedFolderPath ){
				resolve(folderItems)
			}
		})
	})
}

module.exports = { entry }