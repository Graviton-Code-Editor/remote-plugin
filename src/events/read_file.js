const fs = require('fs')
const { sanitizePath } = require('../utils')

const readFile = ({ emitter, filePath }) => {
	fs.readFile(filePath,'UTF-8', (err, fileContent) => {
		if(!err){
			emitter.emit('message',{
				type: 'returnGetFileContent',
				content:{
					filePath: sanitizePath(filePath),
					fileContent
				}
			})
		}
	})
}

module.exports = readFile