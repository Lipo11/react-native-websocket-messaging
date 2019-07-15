'use strict';

import { AppState } from 'react-native';
import EventEmitter from 'EventEmitter';

import Args from './args';

const MsgStatus = Object.freeze({ NOT_SEND: 0, CONNECTED: 1, SENT: 2, RECEIVED: 3, REPLIED: 4, TIMEOUT: 5 });

class Reply
{
	constructor( connection, session_id, data, flow_id = null )
	{
		this.connection = connection;
		this.session_id = session_id;
		this.data = data;
		this.flow_id = flow_id;
	}

	reply( data, ...args )
	{
		let { on_status, timeout_ms, options } = Args.parse( args,
		{
			on_status: [ 'function', undefined ],
			timeout_ms: [ 'number', 600000 ],
			options: [ 'object', null ]
		});

		if( this.flow_id && !data['flow-id'] ){ data['flow-id'] = this.flow_id; }

		return this.connection.send( this.session_id, data, on_status, timeout_ms, options );
	}

	end( data, ...args )
	{
		let { on_status, timeout_ms, options } = Args.parse( args,
		{
			on_status: [ 'function', undefined ],
			timeout_ms: [ 'number', 600000 ],
			options: [ 'object', null ]
		});

		return this.connection.end( this.session_id, data, on_status, timeout_ms, options );
	}

	destroy(){}
}

class Message
{
	constructor( connection, session_id, action, data, on_status, timeout_ms, options, resolve, reject )
	{
		this.connection = connection;
		this.session_id = session_id;
		this.flow_id = data['flow-id'];
		this.action = action;
		this.data = data;
		this.on_status = on_status;
		this.resolve = resolve;
		this.reject = reject;
		this.status = this.max_status = MsgStatus.NOT_SEND;

		if( this.reject )
		{
            // TODO: porozmyslat ci by sa nemali spravy automazat po case vzdy aj ked nemaju reject po nejakom max intervale
            this.timer = setTimeout( this._timeout.bind( this ), timeout_ms );
		}

		this.connection.messages.set( session_id, this );
	}

	payload()
	{
		const payload = { 'session-id': this.session_id, data: this.data };

		if( this.action )
		{
			payload.action = this.action;
		}

		return JSON.stringify( payload );
	}

	on_status_changed( status, data = undefined )
	{
		if( status === 'NETWORKING' )
		{
			if( typeof MsgStatus[data] !== 'undefined' )
			{
				if( MsgStatus[data] === MsgStatus.TIMEOUT )
				{
					this.max_status = Math.max( this.max_status, MsgStatus.TIMEOUT - 1 );
				}

				if( MsgStatus[data] > this.max_status )
				{
					for( let s in MsgStatus )
					{
						if( MsgStatus[s] > this.max_status && MsgStatus[s] < MsgStatus[data] )
						{
							this.on_status_changed( status, s );
						}
					}
				}

				this.status = MsgStatus[data];

				if( this.max_status < this.status )
				{
					this.max_status = this.status;
				}
				else{ return; }
			}
			else{ return; }
		}

		if( this.on_status )
		{
			this.on_status( status, data );
		}

		if( !this.resolve && status === 'NETWORKING' && this.max_status >= MsgStatus.RECEIVED )
		{
			this.destroy();
		}
	}

	on_reply( data )
	{
		this.on_status_changed( 'NETWORKING', 'REPLIED' );

		if( this.resolve )
		{
			this.resolve( new Reply( this.connection, this.session_id + 1, data, this.flow_id ) );
		}

		this.destroy();
	}

	_timeout( data )
	{
		this.on_status_changed( 'NETWORKING', 'TIMEOUT' );

		if( this.reject )
		{
			this.reject( 'timeout' );
		}

		this.destroy();
	}

	destroy()
	{
		if( this.reject )
		{
            clearTimeout( this.timer );
		}

		this.connection.messages.delete( this.session_id );
	}
}

class Connection extends EventEmitter
{
	constructor( dispatcher, servers )
	{
		super();

		this.dispatcher				= dispatcher;
		this.company_id				= company_id;
		this.host					= servers[0].host;
		this.port					= servers[0].port;
		this.ws						= null;
		this.authenticated			= false;
		this.session_id_iterator	= Math.floor((new Date()).getTime()/1000) % 219902325 * 10000 + Math.floor( Math.random() * 10000 );
		this.messages				= new Map();
		this.events					= new Map();
        this.paused					= false;
        this.app_state              = 'active';

        this.connect();
        
        this.connection_temporary_reviver = setTimeout( this._temporary_reviver.bind(this), 1000 );

        AppState.addEventListener( 'change', this._handleAppStateChange );
    }
    
    _handleAppStateChange( next_app_state )
    {
		this.app_state = next_app_state;
		
		if( this.app_state === 'active' )
		{
			this.resume();
		}
		else
		{
			this.pause();
		}
    }

	changeServers( servers )
	{
		this.host = servers[0].host;
		this.port = servers[0].port;

		this.reconnect();
	}

	_temporary_reviver()
	{
		if( this.app_state === 'active' && !this.ws )
		{
			if( this.paused )
			{
				this.resume();
			}
			else
			{
				this.connect();
			}
        }
        
        this.connection_temporary_reviver = setTimeout( this._temporary_reviver.bind(this), 1000 );
	}

	_get_session_id()
	{
		return ( this.session_id_iterator = ( this.session_id_iterator + 1 ) % 2199023255552 ) * 2048;
	}

	start()
	{
		this.connect();
	}

	destroy()
	{
		this.disconnect();

		for( let message of this.messages.values() )
		{
			message.destroy();
		}
	}

	closeAction( flow_id )
	{
		for( let message of this.messages.values() )
		{
			if( message.flow_id === flow_id )
			{
				message.destroy();
			}
		}
	}

	async connect()
	{
		if( !this.paused )
		{
			if( this.ws )
			{
				let ws = this.ws; this.ws = null;

				ws.close();
			}

			const WS = this.ws = new WebSocket( this.host + ':' + this.port );

			try
			{
				WS.onopen = async () =>
				{
					this.send( 'connect',
						{
							platform 	: 'ios'
						}, 15000 )
						.then( async( response ) =>
						{
							if( response.data.status === 'ok' )
							{
								this.authenticated = true;

								this._send_messages();
							}
							else
							{
								this.disconnect();
							}

							this._trigger( 'connectionState', this.connected );
						})
						.catch( err =>
						{
							this.disconnect();
						});

					for( let [ session_id, message ] of this.messages )
					{
						if( message.status === MsgStatus.NOT_SEND )
						{
							message.on_status_changed( 'NETWORKING', 'CONNECTED' );
						}
					}
				};

				WS.onmessage = ( msg ) =>
				{
					const message = JSON.parse( msg.data );
					let sent_message = null;

					if( message['confirm-id'] )
					{
						if( ( sent_message = this.messages.get( message['confirm-id'] ) ) )
						{
							sent_message.on_status_changed( 'NETWORKING', 'RECEIVED' );
						}
					}
					else if( message['session-id'] % 2048 === 0 )
					{
						this._confirm( message['session-id'] );

						try
						{
							this.dispatcher['on_'+message.action+'_message']( new Reply( this, message['session-id'], message.data ) );
						}
						catch(e)
						{
							//console.log('Unhandled dispatcher', message);
						}
					}
					else if( ( sent_message = this.messages.get( message['session-id'] - 1 ) ) )
					{
						this._confirm( message['session-id'] );

						sent_message.on_reply( message.data );
					}
					else
					{
						//console.log('Unhandled Reply', message);
					}
				};

				WS.onerror = ( e ) =>
				{
					console.log('onerror', e);
				};

				WS.onclose = ( err ) =>
				{
					console.log('onclose', err);

					for( let [ session_id, message ] of this.messages )
					{
						if( message.action === 'connect' )
						{
							message.destroy();
							this.messages.delete( session_id );
						}
						else if( message.status === MsgStatus.SENT )
						{
							message.status = MsgStatus.CONNECTED;
						}
					}

					if( WS === this.ws )
					{
						this.ws = null;
						this.authenticated = false;

						this._trigger( 'connectionState', this.connected );

						setTimeout( this.reconnect.bind( this ), 500 );
					}
				};

				this._trigger( 'connectionState', this.connected );
			}
			catch(e)
			{
				console.log('catch', e);
				if( WS === this.ws )
				{
					this.ws = null;
					this.authenticated = false;

					this._trigger( 'connectionState', this.connected );

					this.reconnect();
				}
			}
		}
		else{ this.reconnect(); }
	}

	async disconnect()
	{
		if( this.ws )
		{
			try
			{
				this.ws.close();
			}
			catch(e){}

			this.ws = null;
		}
	}

	async reconnect()
	{
		// TODO postupne zvysovat cas ze sa nezadzubame
		if( !this.paused )
		{
			this.disconnect();
			this.connect();
		}
	}

	async pause()
	{
		if( !this.paused )
		{
			this.paused = true;

			this.disconnect();
		}
	}

	async resume()
	{
		if( this.paused )
		{
			this.paused = false;

			this.connect();
		}
	}

	async send( action, data, ...args )
	{
		let { on_status, timeout_ms, options } = Args.parse( args,
		{
			on_status: [ 'function', undefined ],
			timeout_ms: [ 'number', 600000 ],
			options: [ 'object', null ]
		});

		const session_id = ( typeof action === 'number' ? action + 1 : this._get_session_id() );
		if( typeof action === 'number' ){ action = undefined; }

		if( !options || options.await !== false )
		{
			return new Promise( ( resolve, reject ) =>
			{
				let message = new Message( this, session_id, action, data, on_status, timeout_ms, options, resolve, reject );

				if( this.ws && this.ws.readyState === this.ws.OPEN )
				{
					message.on_status_changed( 'NETWORKING', 'CONNECTED' );
				}

				this._send_messages();
			});
		}
		else
		{
			new Message( this, session_id, action, data, on_status, timeout_ms, options, null, null );

			this._send_messages();
		}
	}

	async end( action, data, ...args )
	{
		let { on_status, timeout_ms, options } = Args.parse( args,
		{
			on_status: [ 'function', undefined ],
			timeout_ms: [ 'number', 600000 ],
			options: [ 'object', null ]
		});

		if( !options ){ options = {}; }
		options.await = false;

		this.send( action, data, on_status, timeout_ms, options );
	}

	get connected(){ return this.ws && this.ws.readyState === this.ws.OPEN && this.authenticated; }

	_trigger( event, value, repeatIfEqual = false )
	{
		let lastEmittedValue = this.events.get( event );

		if( repeatIfEqual || !lastEmittedValue || lastEmittedValue !== value )
		{
			this.emit( event, value );
			this.events.set( event, value );
		}
	}

	_send_messages()
	{
		if( this.ws && this.ws.readyState === this.ws.OPEN )
		{
			for( let message of this.messages.values() )
			{
				if( message.status < MsgStatus.SENT && ( this.authenticated || message.action === 'connect' ) )
				{
					try
					{
						this.ws.send( message.payload() );

						message.on_status_changed( 'NETWORKING', 'SENT' );
					}
					catch(e){}
				}
			}
		}
	}

	_confirm( session_id )
	{
		if( this.ws && this.ws.readyState === this.ws.OPEN )
		{
			try
			{
				this.ws.send( JSON.stringify({ 'confirm-id' : session_id }) );
			}
			catch(e){}
		}
	}
}

module.exports = Connection;
