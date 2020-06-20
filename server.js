const express = require('express')
const hyperswarm = require('hyperswarm')
const { createHash, randomBytes } = require('crypto')
const { encrypt, decrypt } = require("strong-cryptor")

const app = express()

const port = process.argv[2]
const room = process.argv[3]
const pass = process.argv[4]

app.get('/', function (req, res) {})

const swarm = hyperswarm({
	id: randomBytes(32)
})

const topic = createHash('sha256')
	.update(room)
	.digest()

swarm.join(topic, {
	lookup: true, 
	announce: true 
})

swarm.on('connection', (socket, details) => {
	socket.on("error", err =>{
		const msg = Buffer.from(err.data).toString()
		process.send({
			type: 'err',
			content: msg
		})
		process.send({
			type: 'userLeft',
			content: ''
		})
	})
	socket.on("data", data =>{
		const msg = Buffer.from(data).toString()
	})
	process.send({
		type: 'userFound',
		content: ''
	})
	process.on('message', data =>{
		socket.write(data)
	})
})

swarm.on('disconnection', (socket, info) => {
	process.send({
		type: 'userLeft',
		content: ''
	})
})


app.listen(port)