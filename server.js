const express = require('express')
const hyperswarm = require('hyperswarm')
const { createHash } = require('crypto')
const { encrypt, decrypt } = require("strong-cryptor")


const app = express()

const port = process.argv[2]
const room = process.argv[3]
const pass = process.argv[4]

app.get('/', function (req, res) {})

const swarm = hyperswarm()

const topic = createHash('sha256')
	.update(room)
	.digest()

swarm.join(topic, {
	lookup: true, 
	announce: true 
})

swarm.on('connection', (socket, details) => {
	const isMe = details.client
	socket.on("error", err =>{
		process.send({
			type: 'err',
			content: err
		})
		process.send({
			type: 'userLeft',
			content: ''
		})
	})
	socket.on("data", data =>{
		if(data && typeof data == 'object') process.send(JSON.parse(data))
	})
	process.send({
		type: 'userFound',
		content: ''
	})
	if( !isMe ){
		process.on('message', data =>{
			socket.write(JSON.stringify(data))
		})
	}
})

swarm.on('disconnection', (socket, info) => {
	process.send({
		type: 'userLeft',
		content: ''
	})
})


app.listen(port)