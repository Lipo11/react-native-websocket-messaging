# React native websocket messaging ( client IPC )
Wrapper for react native websocket communication

### Installing
```
npm install react-native-websocket-messaging --save
- or -
yarn add react-native-websocket-messaging
```

### Usage
```
import React from 'react';
import WSMessaging from 'react-native-websocket-messaging';

export default class Example extends React.Component
{
    constructor()
    {
        this.connection = new Connection( this, [ { host: 'wss://127.0.0.1', port: 21 } ] );
    }

    componentDidMount()
    {
        this.connection.send( 'hello',
        {
            data : {}
        },
        ( status, data ) =>
        {
            if( status === 'NETWORKING' )
            {
                switch( data )
                {
                    case 'SENT' 	: console.log( 'message:sent' ); break;
                    case 'RECEIVED' : console.log( 'message:received' ); break;
                    case 'REPLIED' 	: console.log( 'message:replied' ); break;
                    case 'TIMEOUT' 	: console.log( 'message:timeout' ); break;
                }
            }
        }, 10000 )
        .then( async ( message ) =>
        {
            //YOUR LOGIC HERE

            return message.reply({ ok: true }, 5000);
        })
        .then( async ( message ) =>
        {
            //YOUR LOGIC HERE, SECOND MESSAGE REPLY
        })
        .catch(( e ) =>
        {
            //Error handling here ( timeot, ... )
        });
    }

    async on_pair_message( message )
    {
        //HANDLING YOR MESSAGE FROM SERVER
    }
}
```
### API

#### changeServers
Easily changing ip & port
Example:
```
import WSMessaging from 'react-native-websocket-messaging';

export default class Example extends React.Component
{
    componentWillUnmount()
	{
		this.connection.changeServers( [ { host: 'wss://127.0.0.1', port: 21 } ] );
	}
}
```

#### connected
Detection of connect status
Example:
```
import WSMessaging from 'react-native-websocket-messaging';

export default class Example extends React.Component
{
    componentWillUnmount()
	{
		this.connection.connected;
	}
}
```

#### destroy
Destroy connection
Example:
```
import WSMessaging from 'react-native-websocket-messaging';

export default class Example extends React.Component
{
    componentWillUnmount()
	{
		this.connection.destroy();
	}
}
```