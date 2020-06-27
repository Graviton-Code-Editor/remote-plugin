const { getExtension } = require('./utils')
const { basename } = require('path')
const getFileContent = require('./file_content')

const createTabEditor = async ({
	filePath, 
	folderPath, 
	emitter, 
	Editor,
	Tab
}) => {
	const { bodyElement, tabElement, tabState, isCancelled } = new Tab({
		isEditor: true,
		title: basename(filePath),
		directory: filePath,
		parentFolder: folderPath
	})
	if (!isCancelled) {
		const { client, instance } = new Editor({
			language: getExtension(filePath),
			value: await getFileContent({
				emitter,
				filePath
			}),
			theme: 'Night',
			bodyElement,
			tabElement,
			tabState,
			directory: filePath
		})
	}
}

module.exports = createTabEditor