const userJoined = ({
	room,
	username,
	Notification
}) => {
	new Notification({
		title: `User ${username} just joined #${room}`,
		content: ''
	})
}

module.exports = userJoined
