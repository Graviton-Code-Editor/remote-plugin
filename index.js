import fs from 'fs'
import { join, basename, dirname, extname, normalize } from "path"
import shortid from 'shortid'
import randomColorRGB from 'random-color-rgb'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

import listFolder from './src/events/list_folder'
import tabCreated from './src/events/tab_created'
import readFile from './src/events/read_file'
import writeFile from './src/events/write_file'
import userJoined from './src/events/user_joined'
import configDialog from './src/config_dialog'
import createTabEditor from './src/tab_editor'

import { sanitizePath, getExtension }from './src/utils'

import { createHash } from 'crypto'
import { Encryptor, Decryptor } from 'strong-cryptor'

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
		this.roomcode = `${this.room}##${password}`
		
		this.conn.onopen = () => {
			//Tell the whole room you joined
			this.send('userJoin',{
				username: this.username
			})
			
			setInterval(() => {
				//Send a ping to the connection socket, so it doesn't die
				this.send('connectionPing',{})
				
			}, 30000)
			
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


export function entry(API){
	const { puffin, StatusBarItem, ContextMenu, Notification, RunningConfig } = API 
	const emitter = new puffin.state({})
	createSidePanel(emitter,API)
	console.log(Notification)
	RunningConfig.emit('addLocalTerminalAccessory',{
		component(state){
			
			function goShare(){
				emitter.emit('message',{
					type: 'terminalShared',
					content: {}
				})
				emitter.on("room/terminalOutput",({ data }) => {
					state.emit("data", data);
				}),
					emitter.on("room/terminalBreakLine", () => {
					state.emit("breakLine");
				}),
				state.on('write', (data) => {
					emitter.emit('message',{
						type: 'terminalUpdated',
						content: {
							data
						}
					})
				})
			}
			
			return puffin.element`<button :click="${goShare}">share</button>`
		}
	})
		
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
}

function handleEvents(emitter,API){
	const { RunningConfig } = API
	
	emitter.on('room/terminalShared', async ({ senderUsername }) => {
		RunningConfig.emit('registerTerminalShell',{
			name: `remote@${senderUsername}`,
			onCreated(state){
				emitter.on('room/terminalUpdated',({ data, senderUsername: terminalAuthor }) => {
					if(senderUsername === terminalAuthor){
						state.emit('write', data)
					}
				})
				
				state.on('keyPressed',(key) => {
					if(key === 'Enter'){
						emitter.emit('message', {
							type: 'terminalBreakLine',
							content: {}
						})
					}
				})
				
				state.on('data', (data) => {
					emitter.emit('message', {
						type: 'terminalOutput',
						content:{
							data
						}
					})
				})
			}
		})
	})

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
	emitter.on('room/writeFileContent', async ({ filePath, fileContent }) => {
		writeFile({
			emitter,
			filePath,
			fileContent
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
	RunningConfig.on('aTabHasBeenCreated', ({ directory, client, instance, tabElement }) => {
		tabCreated({
			emitter,
			directory,
			client,
			instance,
			tabElement,
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
							},
							iconComp(){
								return puffin.element`
									<svg width="20" height="20" viewBox="0 0 45 45" fill="none" xmlns="http://www.w3.org/2000/svg">
										<path d="M9 38.2727C9 32.6494 13.5586 28.0909 19.1818 28.0909H26.8182C32.4414 28.0909 37 32.6494 37 38.2727V38.2727H9V38.2727Z" fill="#919191"/>
										<path d="M11.5454 20.4545C11.5454 14.1284 16.6738 9 23 9V9C29.3262 9 34.4545 14.1284 34.4545 20.4545V20.4545C34.4545 26.7807 29.3262 31.9091 23 31.9091V31.9091C16.6738 31.9091 11.5454 26.7807 11.5454 20.4545V20.4545Z" fill="#919191"/>
									</svg>
								`
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
							iconComp(){
								return puffin.element`
									<svg width="20" height="20" viewBox="0 0 45 45" fill="none" xmlns="http://www.w3.org/2000/svg">
										<path d="M16 29.9999C16 26.1579 19.1145 23.0434 22.9565 23.0434H29.0435C32.8855 23.0434 36 26.1579 36 29.9999V29.9999H16V29.9999Z" fill="#919191"/>
										<path d="M17.8182 17.8261C17.8182 13.5039 21.322 10 25.6443 10H26.3557C30.6779 10 34.1818 13.5039 34.1818 17.8261V17.8261C34.1818 22.1483 30.6779 25.6522 26.3557 25.6522H25.6442C21.322 25.6522 17.8182 22.1483 17.8182 17.8261V17.8261Z" fill="#919191"/>
										<path d="M10 33.9999C10 30.1579 13.1145 27.0434 16.9565 27.0434H23.0435C26.8855 27.0434 30 30.1579 30 33.9999V33.9999H10V33.9999Z" fill="#A4A4A4"/>
										<path d="M11.8182 21.8261C11.8182 17.5039 15.322 14 19.6443 14H20.3557C24.6779 14 28.1818 17.5039 28.1818 21.8261V21.8261C28.1818 26.1483 24.6779 29.6522 20.3557 29.6522H19.6442C15.322 29.6522 11.8182 26.1483 11.8182 21.8261V21.8261Z" fill="#A4A4A4"/>
									</svg>
								`
							},
							mounted({ setItems, setDecorator }){
								emitter.on('instance/connected',({ room, userid, username, usercolor }) => {
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
									document.getElementById('room_name').innerText = room
									
									dayjs.extend(relativeTime)
									const startedDate = dayjs(new Date())
									setInterval(() => {
										document.getElementById('time_counter').innerText = startedDate.fromNow()
									})
									
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

				emitter.on('room/openedFolder', async ({ folderPath, senderUserid, senderUsername }) => {
					new FilesExplorer(folderPath, folderPath, document.getElementById('explorer_panel'), 0, false, null, {
						provider: {
							decorator:{
								text: `remote@${senderUsername}`
							},
							listDir: async function(path){
								return await getItemsInFolder(emitter, path, senderUserid)
							},
							isGitRepo(){
								return new Promise( res => res(false))
							},
							readFile: function (path) {
								return new Promise( async (res) => {
									
									emitter.once('room/returnGetFileContent',({
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
							},
							writeFile: function (filePath, fileContent) {
								return new Promise( async (res) => {
									emitter.emit('message',{
										type: 'writeFileContent',
										content: {
											filePath,
											fileContent
										}
									})
									res()
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
					${getInfoCards(emitter, API)}
					<div id="users"/>
				</div>
			`
		}
	})
}

const getInfoCards = (emitter, API) => {
	const { puffin, drac, Dialog } = API
	const cardStyle = puffin.style`
		& > div{
			background: var(--sidebarBackground);
			border-radius: 15px;
			height: 110px;
			width: 110px;
			padding: 30px 15px;
			user-select: none;
			overflow: hidden;
		}
		& > div > h6 {
			margin: 3px 0px;
			font-size: 11px;
			font-weight: bold;
		}
		& > div >  span {
			font-size: 13px;
			color: var(--accentColor);
			margin: 2px 0px;
		}
	`
	
	function shareRoom(){
		const codeDialog = new Dialog({
			title: `Room's Code`,
			component(){
				return puffin.element`<p style="user-select: all; word-break: break-all;">${emitter.data.roomcode}</p>`
			},
			buttons:[
				{
					label: 'misc.Accept'
				}
			]
		})
		codeDialog.launch()
	}
	
	return puffin.element({
		components:{
			Card: drac.Card
		}
	})`
		<div class="${cardStyle}">
			<Card :click="${shareRoom}">
				<h6>SHARE ROOM</h6>
				<span id="room_name">None</span>
			</Card>
			<Card>
				<h6>TIME</h6>
				<span id="time_counter">None</span>
			</Card>
		</div>
	`
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
		emitter.once('room/returnlistFolder',({ folderPath: returnedFolderPath, folderItems })=>{
			if( folderPath === returnedFolderPath ){
				resolve(folderItems)
			}
		})
	})
}
