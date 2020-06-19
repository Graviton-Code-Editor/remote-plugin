const express = require('express')
const app = express()

const port = process.argv[2]

app.get('/', function (req, res) {
	
})

const hyperswarm = require('hyperswarm')
const { decrypt, encrypt, createHash } = require('crypto')

const swarm = hyperswarm()

const topic = createHash('sha256')
	.update('gv')
	.digest()

swarm.join(topic, {
	lookup: true, 
	announce: true 
})

swarm.on('connection', (socket, details) => {
	socket.on("error", err =>{
		process.send({
			type: 'error',
			content: err
		})
		process.send({
			type: 'userLeft',
			content: ''
		})
	})
	socket.on("data", data =>{
		process.send(JSON.parse(data))
	})
	process.send({
		type: 'userJoined',
		content: ''
	})
	process.on('message', data =>{
		socket.write(JSON.stringify(data))
	})
})

swarm.on('disconnection', (socket, info) => {
	process.send({
		type: 'userLeft',
		content: ''
	})
})


app.listen(port)