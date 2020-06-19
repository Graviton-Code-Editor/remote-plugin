const express = require("express")
const fs = require("fs")
const { join, basename, dirname } = require("path")

const executeServer = (API,room,password) => {
	const { puffin } = API
	const express = require('express')
	const { fork }  = require("electron").remote.require("child_process")

	const emitter = new puffin.state({})
	const app = express()
	const clientPort = `${Math.random()*1000}`.substring(13)
	const serverPort = `${Math.random()*1000}`.substring(13)
	const subprocess = fork(join(__dirname,"./server.js"),[serverPort,room,password])

	console.log(clientPort,serverPort)
	
	subprocess.on('message', ({ type, content}) => {
		emitter.emit(type,content)
	});
	subprocess.on('close', code => {
		console.log(`child process close all stdio with code ${code}`);
	});
	subprocess.on('exit', code => {
		console.log(`child process exited with code ${code}`);
	});
	
	console.log(subprocess)
	
	const server = app.listen(Number(clientPort))
	
	emitter.on('message',data =>{
		subprocess.send(data)
	})
	
	emitter.on('close',()=>{
		server.close()
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