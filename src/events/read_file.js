const fs = require('fs')
const { sanitizePath } = require('../utils')

const readFile = ({ emitter, filePath }) => {
	fs.readFile(sanitizePath(filePath),'UTF-8', (err, fileContent) => {
		console.log(err,fileContent)
		if(!err){
			emitter.emit('message',{
				type: 'returnGetFileContent',
				content:{
					filePath: sanitizePath(filePath),
					fileContent
				}
			})
		}else{
			console.error(err)
		}
	})
}

module.exports = readFile