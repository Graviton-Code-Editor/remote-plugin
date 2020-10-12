import { getExtension } from './utils'
import { basename } from 'path'
import getFileContent from './file_content'

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

export default createTabEditor