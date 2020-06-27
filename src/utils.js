const { normalize, extname } = require('path')

const sanitizePath = path => normalize(path).replace(/\\/g, '/')

const getExtension = path => extname(path).split('.')[1]

module.exports = {
	sanitizePath,
	getExtension
}
