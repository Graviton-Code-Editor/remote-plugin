const configDialog = ({ puffin, Dialog, drac }) => {
	return new Promise((resolve, reject)=>{
		const dialog = new Dialog({
			title: 'Join',
			height: '270px',
			component(){
				const styleWrapper = puffin.style`
					& {
						display: flex;
						flex-direction: column;
					}
					& > div {
						display: flex;
						flex: 1;
					}
					& > div label {
						width: 120px;
						height: 100%;
						margin: auto 0;
					}
					& > div input {
						flex: 1;
						max-width: 60%;
					}
				`
				return puffin.element({
					components:{
						Input: drac.Input
					}
				})`
				<div class="${styleWrapper}">
					<div>
						<label>Room</label> 
						<Input placeHolder="CodeParty" id="room"/>
					</div>
					<div>
						<label>Username</label> 
						<Input placeHolder="Superman" id="username"/>
					</div>
					<div>
						<label>Password</label> 
						<Input type="password" id="password"/>
					</div>
				</div>
				`
			},
			buttons:[
				{
					label: 'Connect',
					action(){
						const room = document.getElementById('room').value || 'public'
						const username = document.getElementById('username').value 
						const password = document.getElementById('password').value.repeat(32).substring(0,32)
						resolve({
							room,
							username,
							password
						})
					}
				}
			]
		})
		dialog.launch()
	})
}

export default configDialog