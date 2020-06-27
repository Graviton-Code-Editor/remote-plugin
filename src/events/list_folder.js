const fs = require('fs')
const { join } = require('path')

const listFolder = ({ folderPath, emitter }) => {
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
}

module.exports = listFolder