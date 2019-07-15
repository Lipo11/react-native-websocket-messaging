'use strict';

function isOfType( arg, type )
{
	if( type === 'array' )
	{
		return Array.isArray( arg );
	}
	else
	{
		return ( typeof arg === type );
	}
}

module.exports = class Args
{
	static parse( args, signature ) // { timeout: [ 'number', 60000 ] }
	{
		if( !args ){ args = []; }
		const params = {};

		for( let param in signature )
		{
			for( let i = 0; i < args.length; ++i )
			{
				if( isOfType( args[i], signature[param][0] ) )
				{
					params[param] = args[i];
					args.splice(i, 1);

					break;
				}
			}

			if( typeof params[param] === 'undefined' )
			{
				params[param] = ( typeof signature[param][1] === 'object'? JSON.parse(JSON.stringify( signature[param][1] )) : signature[param][1] );
			}
		}

		return params;
	}
};
