import fs from 'fs'
import { sanitizePath  } from '../utils'

const writeFile = ({ emitter, filePath, fileContent }) => {
	fs.writeFile(sanitizePath(filePath), fileContent, (err) => {
		if(err) console.log(err)
	})
}

export default writeFile