const express = require("express")

const executeServer = (API) => {
	const { puffin } = API
	const express = require('express')
	const { fork }  = require("electron").remote.require("child_process")
	const { join } = require("path")
	
	const emitter = new puffin.state({})
	const app = express()
	const clientPort = `${Math.random()*1000}`.substring(13)
	const serverPort = `${Math.random()*1000}`.substring(13)
	const subprocess = fork(join(__dirname,"./server.js"),[serverPort])

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
			const emitter = executeServer(API)
			emitter.on('userJoined', async ({ type}) => {
				console.log('New user joined the room!')
			})
			emitter.on('userLeft', async ({ type}) => {
				console.log('A user left the room!')
			})
			emitter.on('listFolder', async (folderPath) => {
				fs.readdir(dir,(err, list)=>{
					process.send({
						type: 'returnListFolder',
						content: list
					})
				})
			})
			RunningConfig.on('addFolderToRunningWorkspace', ({ folderPath }) => {
				emitter.emit('message',{
					type: 'openedFolder',
					content: folderPath
				})
				emitter.on('returnListFolder', async (dirs) => {
					console.log(dirs)
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
			const emitter = executeServer(API)
			emitter.on('userJoined', async ({ type}) => {
				console.log('New user joined the room!')
			})
			new StatusBarItem({
				label: 'stop',
				action(){
					emitter.emit('close')
				}
			})
			emitter.on('openedFolder', async (folderPath) => {
				console.log('Somebody opened ', folderPath)
			})
		}
	})

}

module.exports = { entry }