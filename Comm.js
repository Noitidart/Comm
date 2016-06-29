/* global Deferred, genericReject, genericCatch */
/* server.framescript - global Services.mm */
/* server.worker - global ChromeWorker, Worker */
/* server.content and no ports passed - global Worker, Blob */
if (typeof(gCommScope) == 'undefined') { // optional global, devuser can specify something else, and in case of Comm.client.framescript he will have to
	var gCommScope = this;
}

var gCommContentFrameMessageManager = this;
var Comm = {
	unregister_generic: function(category, type, self) {
		var instances = Comm[category].instances[type];
		var l = instances.length;
		for (var i=0; i<l; i++) {
			if (instances[i] == this) {
				instances.splice(i, 1);
				break;
			}
		}
	},
	server: {
		// these should be executed OUT of the scope. like `new Comm.server.worker()` should be executed in bootstrap or another worker
		worker: function(aWorkerPath, onBeforeInit, onAfterInit, aWebWorker) {
			var type = 'worker';
			var category = 'server';
			var scope = gCommScope;
			Comm[category].instances[type].push(this);
			var messager_method = 'putMessage';

			var worker;

			this.nextcbid = 1;
			this.callbackReceptacle = {};
			this.reportProgress = function(aProgressArg) {
				aProgressArg.__PROGRESS = 1;
				this.THIS[messager_method](this.cbid, aProgressArg);
			};

			this[messager_method] = function(aMethod, aArg, aCallback) {
				// aMethod is a string - the method to call in framescript
				// aCallback is a function - optional - it will be triggered when aMethod is done calling

				if (!worker) {
					this.createWorker(this[messager_method].bind(this, aMethod, aArg, aCallback));
				} else {
					var aTransfers;
					if (aArg && aArg.__XFER) {
						// if want to transfer stuff aArg MUST be an object, with a key __XFER holding the keys that should be transferred
						// __XFER is either array or object. if array it is strings of the keys that should be transferred. if object, the keys should be names of the keys to transfer and values can be anything
						aTransfers = [];
						var __XFER = aArg.__XFER;
						if (Array.isArray(__XFER)) {
							for (var p of __XFER) {
								aTransfers.push(aArg[p]);
							}
						} else {
							// assume its an object
							for (var p in __XFER) {
								aTransfers.push(aArg[p]);
							}
						}
					}
					var cbid = null;
					if (typeof(aMethod) == 'number') {
						// this is a response to a callack waiting in framescript
						cbid = aMethod;
						aMethod = null;
					} else {
						if (aCallback) {
							cbid = this.nextcbid++;
							this.callbackReceptacle[cbid] = aCallback;
						}
					}

					worker.postMessage({
						method: aMethod,
						arg: aArg,
						cbid
					}, aTransfers);
				}
			};

			this.listener = function(e) {
				var payload = e.data;
				console.log('Comm.'+category+'.'+type+' - incoming, payload:', payload); //, 'e:', e);

				if (payload.method) {
					if (payload.method == 'triggerOnAfterInit') {
						if (onAfterInit) {
							onAfterInit(payload.arg, this);
						}
						return;
					}
					if (!(payload.method in scope)) { console.error('method of "' + payload.method + '" not in scope'); throw new Error('method of "' + payload.method + '" not in scope') } // dev line remove on prod
					var rez_scope = scope[payload.method](payload.arg, payload.cbid ? this.reportProgress.bind({THIS:this, cbid:payload.cbid}) : undefined, this);
					// in the return/resolve value of this method call in scope, (the rez_blah_call_for_blah = ) MUST NEVER return/resolve an object with __PROGRESS:1 in it

					if (payload.cbid) {
						if (rez_scope && rez_scope.constructor.name == 'Promise') {
							rez_scope.then(
								function(aVal) {
									// console.log('Comm.'+category+'.'+type+' - Fullfilled - rez_scope - ', aVal);
									this[messager_method](payload.cbid, aVal);
								}.bind(this),
								genericReject.bind(null, 'rez_scope', 0)
							).catch(genericCatch.bind(null, 'rez_scope', 0));
						} else {
							this[messager_method](payload.cbid, rez_scope);
						}
					}
				} else if (!payload.method && payload.cbid) {
					// its a cbid
					this.callbackReceptacle[payload.cbid](payload.arg, this);
					if (payload.arg && !payload.arg.__PROGRESS) {
						delete this.callbackReceptacle[payload.cbid];
					}
				}
				else { console.error('Comm.'+category+'.'+type+' - invalid combination. method:', payload.method, 'cbid:', payload.cbid, 'payload:', payload); throw new Error('Comm.'+category+'.'+type+' - invalid combination'); }
			}.bind(this);

			this.unregister = function() {
				Comm.unregister_generic(category, type, this);
			};

			this.createWorker = function(onAfterCreate) {
				// only triggered by putMessage when `var worker` has not yet been set
				worker = aWebWorker ? new Worker(aWorkerPath) : new ChromeWorker(aWorkerPath);
				worker.addEventListener('message', this.listener);

				if (onAfterInit) {
					var oldOnAfterInit = onAfterInit;
					onAfterInit = function(aArg, aComm) {
						oldOnAfterInit(aArg, aComm);
						if (onAfterCreate) {
							onAfterCreate(); // link39399999
						}
					}
				}

				var initArg;
				if (onBeforeInit) {
					initArg = onBeforeInit(this);
					if (onAfterInit) {
						this[messager_method]('init', initArg); // i dont put onAfterCreate as a callback here, because i want to gurantee that the call of onAfterCreate happens after onAfterInit is triggered link39399999
					} else {
						this[messager_method]('init', initArg, onAfterCreate);
					}
				} else {
					// else, worker is responsible for calling init. worker will know because it keeps track in listener, what is the first putMessage, if it is not "init" then it will run init
					if (onAfterCreate) {
						onAfterCreate(); // as putMessage i the only one who calls this.createWorker(), onAfterCreate is the origianl putMessage intended by the devuser
					}
				}
			};
		},
		framescript: function(aChannelId) {
			/* global Services.mm */

			var type = 'framescript';
			var category = 'server';
			var scope = gCommScope;
			Comm[category].instances[type].push(this);
			var messager_method = 'copyMessage';

			this.nextcbid = 1;
			this.callbackReceptacle = {};
			this.reportProgress = function(aProgressArg) {
				aProgressArg.__PROGRESS = 1;
				this.THIS[messager_method](this.messageManager, this.cbid, aProgressArg);
			};

			this[messager_method] = function(aMessageManager, aMethod, aArg, aCallback) {
				// console.log('Comm.'+category+'.'+type+' - in messager_method:', aMessageManager, aMethod, aArg, aCallback);

				var cbid = null;
				if (typeof(aMethod) == 'number') {
					// this is a response to a callack waiting in framescript
					cbid = aMethod;
					aMethod = null;
				} else {
					if (aCallback) {
						cbid = this.nextcbid++;
						this.callbackReceptacle[cbid] = aCallback;
					}
				}

				aMessageManager.sendAsyncMessage(aChannelId, {
					method: aMethod,
					arg: aArg,
					cbid
				});
			};

			this.listener = {
				receiveMessage: function(e) {
					var messageManager = e.target.messageManager;
					var browser = e.target;
					var payload = e.data;
					console.log('Comm.'+category+'.'+type+' - incoming, payload:', payload); // , 'messageManager:', messageManager, 'browser:', browser, 'e:', e);

					if (!messageManager) {
						console.warn('Comm.'+category+'.'+type+' - ignoring as no messageManager, e.target:', e.target);
						return;
					}

					if (payload.method) {
						if (!(payload.method in scope)) { console.error('method of "' + payload.method + '" not in scope'); throw new Error('method of "' + payload.method + '" not in scope') }  // dev line remove on prod
						var rez_scope = scope[payload.method](payload.arg, payload.cbid ? this.reportProgress.bind({THIS:this, cbid:payload.cbid, messageManager}) : undefined, this, messageManager, browser);  // only on bootstrap side, they get extra 2 args
						// in the return/resolve value of this method call in scope, (the rez_blah_call_for_blah = ) MUST NEVER return/resolve an object with __PROGRESS:1 in it
						if (payload.cbid) {
							if (rez_scope && rez_scope.constructor.name == 'Promise') {
								rez_scope.then(
									function(aVal) {
										// console.log('Comm.'+category+'.'+type+' - Fullfilled - rez_scope - ', aVal);
										this[messager_method](messageManager, payload.cbid, aVal);
									}.bind(this),
									genericReject.bind(null, 'rez_scope', 0)
								).catch(genericCatch.bind(null, 'rez_scope', 0));
							} else {
								this[messager_method](messageManager, payload.cbid, rez_scope);
							}
						}
					} else if (!payload.method && payload.cbid) {
						// its a cbid
						this.callbackReceptacle[payload.cbid](payload.arg, messageManager, browser, this);
						if (payload.arg && !payload.arg.__PROGRESS) {
							delete this.callbackReceptacle[payload.cbid];
						}
					}
					else { console.error('Comm.'+category+'.'+type+' - invalid combination. method:', payload.method, 'cbid:', payload.cbid, 'payload:', payload); throw new Error('Comm.'+category+'.'+type+' - invalid combination'); }
				}.bind(this)
			};

			this.unregister = function() {
				Comm.unregister_generic(category, type, this);

				// kill framescripts
				Services.mm.broadcastAsyncMessage(aChannelId, {
					method: 'UNINIT_FRAMESCRIPT'
				});
			};

			Services.mm.addMessageListener(aChannelId, this.listener);
		},
		content: function(aContentWindow, onHandshakeComplete, aPort1, aPort2) {
			var type = 'content';
			var category = 'server';
			var scope = gCommScope;
			Comm[category].instances[type].push(this);
			var messager_method = 'putMessage';

			var handshakeComplete = false; // indicates this[messager_method] will now work i think. it might work even before though as the messages might be saved till a listener is setup? i dont know i should ask

			this.nextcbid = 1;
			this.callbackReceptacle = {};
			this.reportProgress = function(aProgressArg) {
				aProgressArg.__PROGRESS = 1;
				this.THIS[messager_method](this.cbid, aProgressArg);
			};

			this[messager_method] = function(aMethod, aArg, aCallback) {
				// aMethod is a string - the method to call in framescript
				// aCallback is a function - optional - it will be triggered when aMethod is done calling
				var aTransfers;
				if (aArg && aArg.__XFER) {
					// if want to transfer stuff aArg MUST be an object, with a key __XFER holding the keys that should be transferred
					// __XFER is either array or object. if array it is strings of the keys that should be transferred. if object, the keys should be names of the keys to transfer and values can be anything
					aTransfers = [];
					var __XFER = aArg.__XFER;
					if (Array.isArray(__XFER)) {
						for (var p of __XFER) {
							aTransfers.push(aArg[p]);
						}
					} else {
						// assume its an object
						for (var p in __XFER) {
							aTransfers.push(aArg[p]);
						}
					}
				}

				var cbid = null;
				if (typeof(aMethod) == 'number') {
					// this is a response to a callack waiting in framescript
					cbid = aMethod;
					aMethod = null;
				} else {
					if (aCallback) {
						cbid = this.nextcbid++;
						this.callbackReceptacle[cbid] = aCallback;
					}
				}

				aPort1.postMessage({
					method: aMethod,
					arg: aArg,
					cbid
				}, aTransfers);
			};

			this.listener = function(e) {
				var payload = e.data;
				console.log('Comm.'+category+'.'+type+' - incoming, payload:', payload); //, 'e:', e);

				if (payload.method) {
					if (payload.method == 'contentComm_handshake_finalized') {
						handshakeComplete = false;
						if (onHandshakeComplete) {
							onHandshakeComplete(this);
						}
						return;
					}
					if (!(payload.method in scope)) { console.error('method of "' + payload.method + '" not in scope'); throw new Error('method of "' + payload.method + '" not in scope') } // dev line remove on prod
					var rez_scope = scope[payload.method](payload.arg, payload.cbid ? this.reportProgress.bind({THIS:this, cbid:payload.cbid}) : undefined, this);
					// in the return/resolve value of this method call in scope, (the rez_blah_call_for_blah = ) MUST NEVER return/resolve an object with __PROGRESS:1 in it
					// console.log('Comm.'+category+'.'+type+' - Fullfilled - rez_scope - rez_scope:', rez_scope);

					if (payload.cbid) {
						if (rez_scope && rez_scope.constructor.name == 'Promise') {
							rez_scope.then(
								function(aVal) {
									// console.log('Comm.'+category+'.'+type+' - Fullfilled - rez_scope - ', aVal);
									this[messager_method](payload.cbid, aVal);
								}.bind(this),
								genericReject.bind(null, 'rez_scope', 0)
							).catch(genericCatch.bind(null, 'rez_scope', 0));
						} else {
							this[messager_method](payload.cbid, rez_scope);
						}
					}
				} else if (!payload.method && payload.cbid) {
					// its a cbid
					this.callbackReceptacle[payload.cbid](payload.arg, this);
					if (payload.arg && !payload.arg.__PROGRESS) {
						delete this.callbackReceptacle[payload.cbid];
					}
				}
				else { console.error('Comm.'+category+'.'+type+' - invalid combination. method:', payload.method, 'cbid:', payload.cbid, 'payload:', payload); throw new Error('Comm.'+category+'.'+type+' - invalid combination'); }
			}.bind(this);

			this.unregister = function() {
				Comm.unregister_generic(category, type, this);
			};

			var postPortsGot = function() {
				aPort1.onmessage = this.listener;
				aContentWindow.postMessage({
					topic: 'contentComm_handshake',
					port2: aPort2
				}, '*', [aPort2]);
			};

			if (!aPort1) {
				var portWorkerBlob = new Blob(['var msgchan = new MessageChannel(); self.postMessage({ port1: msgchan.port1,port2: msgchan.port2 }, [msgchan.port1, msgchan.port2]);'], { type:'plain/text' });
				var portWorkerBlobURL = URL.createObjectURL(portWorkerBlob);
				var portWorker = new ChromeWorker();
				portWorker.onmessage = function(e) {
					aPort1 = e.data.port1;
					aPort2 = e.data.port2;
					postPortsGot();

					portWorker.terminate();
					URL.revokeObjectURL(portWorkerBlobURL);
				};
			} else {
				postPortsGot();
			}
		},
		instances: {worker:[], framescript:[], content:[]},
		unregAll: function(aType) {
			var category = 'server';
			var type_instances_clone = Comm[category].instances[aType].slice(); // as the .unregister will remove it from the original array

			var l = type_instances_clone.length;
			for (var inst of type_instances_clone) {
				inst.unregister();
			}
		}
	},
	client: {
		// these should be excuted in the respective scope, like `new Comm.client.worker()` in worker, framescript in framescript, content in content
		worker: function() {
			var type = 'worker';
			var category = 'client';
			var scope = gCommScope;
			Comm[category].instances[type].push(this);
			var messager_method = 'putMessage';

			var firstMethodCalled = false;

			this.nextcbid = 1;
			this.callbackReceptacle = {};
			this.reportProgress = function(aProgressArg) {
				aProgressArg.__PROGRESS = 1;
				this.THIS[messager_method](this.cbid, aProgressArg);
			};

			this[messager_method] = function(aMethod, aArg, aCallback) {
				var cbid = null;
				if (typeof(aMethod) == 'number') {
					// this is a response to a callack waiting in framescript
					cbid = aMethod;
					aMethod = null;
				} else {
					if (aCallback) {
						cbid = this.nextcbid++;
						this.callbackReceptacle[cbid] = aCallback;
					}
				}

				var aTransfers;
				if (aArg && aArg.__XFER) {
					// if want to transfer stuff aArg MUST be an object, with a key __XFER holding the keys that should be transferred
					// __XFER is either array or object. if array it is strings of the keys that should be transferred. if object, the keys should be names of the keys to transfer and values can be anything
					aTransfers = [];
					var __XFER = aArg.__XFER;
					if (Array.isArray(__XFER)) {
						for (var p of __XFER) {
							aTransfers.push(aArg[p]);
						}
					} else {
						// assume its an object
						for (var p in __XFER) {
							aTransfers.push(aArg[p]);
						}
					}
				}

				self.postMessage({
					method: aMethod,
					arg: aArg,
					cbid
				}, aTransfers);
			};

			this.listener = function(e) {
				var payload = e.data;
				console.log('Comm.'+category+'.'+type+' - incoming, payload:', payload); //, 'e:', e);

				if (payload.method) {
					if (!firstMethodCalled) {
						firstMethodCalled = true;
						if (payload.method != 'init' && scope.init) {
							this[messager_method]('triggerOnAfterInit', scope.init(undefined, this));
						}
					}
					if (!(payload.method in scope)) { console.error('Comm.'+category+'.'+type+' - method of "' + payload.method + '" not in scope'); throw new Error('method of "' + payload.method + '" not in scope') } // dev line remove on prod
					var rez_scope = scope[payload.method](payload.arg, payload.cbid ? this.reportProgress.bind({THIS:this, cbid:payload.cbid}) : undefined, this);
					// in the return/resolve value of this method call in scope, (the rez_blah_call_for_blah = ) MUST NEVER return/resolve an object with __PROGRESS:1 in it
					// console.log('Comm.'+category+'.'+type+' - rez_scope:', rez_scope);
					if (payload.cbid) {
						if (rez_scope && rez_scope.constructor.name == 'Promise') {
							rez_scope.then(
								function(aVal) {
									console.log('Comm.'+category+'.'+type+' - Fullfilled - rez_scope - ', aVal);
									this[messager_method](payload.cbid, aVal);
								}.bind(this),
								genericReject.bind(null, 'rez_scope', 0)
							).catch(genericCatch.bind(null, 'rez_scope', 0));
						} else {
							this[messager_method](payload.cbid, rez_scope);
						}
					}
					// gets here on programtic init, as it for sure does not have a callback
					if (payload.method == 'init') {
						this[messager_method]('triggerOnAfterInit', rez_scope);
					}
				} else if (!payload.method && payload.cbid) {
					// its a cbid
					this.callbackReceptacle[payload.cbid](payload.arg, this);
					if (payload.arg && !payload.arg.__PROGRESS) {
						delete this.callbackReceptacle[payload.cbid];
					}
				}
				else { console.error('Comm.'+category+'.'+type+' - invalid combination. method:', payload.method, 'cbid:', payload.cbid, 'payload:', payload); throw new Error('Comm.'+category+'.'+type+' - invalid combination'); }
			}.bind(this);

			this.unregister = function() {
				Comm.unregister_generic(category, type, this);
			};

			self.onmessage = this.listener;
		},
		framescript: function(aChannelId) {
			var type = 'framescript';
			var category = 'client';
			var scope = gCommScope;
			Comm[category].instances[type].push(this);
			var messager_method = 'copyMessage';

			this.nextcbid = 1;
			this.callbackReceptacle = {};
			this.reportProgress = function(aProgressArg) {
				aProgressArg.__PROGRESS = 1;
				this.THIS[messager_method](this.cbid, aProgressArg);
			};

			this[messager_method] = function(aMethod, aArg, aCallback) {
				var cbid = null;
				if (typeof(aMethod) == 'number') {
					// this is a response to a callack waiting in framescript
					cbid = aMethod;
					aMethod = null;
				} else {
					if (aCallback) {
						cbid = this.nextcbid++;
						this.callbackReceptacle[cbid] = aCallback;
					}
				}

				gCommContentFrameMessageManager.sendAsyncMessage(aChannelId, {
					method: aMethod,
					arg: aArg,
					cbid
				});
			};

			this.listener = {
				receiveMessage: function(e) {
					var messageManager = e.target.messageManager;
					var browser = e.target;
					var payload = e.data;
					console.log('Comm.'+category+'.'+type+' - incoming, payload:', payload); //, 'e:', e);
					// console.log('this in receiveMessage bootstrap:', this);

					if (payload.method) {
						if (!(payload.method in scope)) { console.error('method of "' + payload.method + '" not in scope'); throw new Error('method of "' + payload.method + '" not in scope') }  // dev line remove on prod
						var rez_scope = scope[payload.method](payload.arg, payload.cbid ? this.reportProgress.bind({THIS:this, cbid:payload.cbid}) : undefined, this);
						// in the return/resolve value of this method call in scope, (the rez_blah_call_for_blah = ) MUST NEVER return/resolve an object with __PROGRESS:1 in it
						if (payload.cbid) {
							if (rez_scope && rez_scope.constructor.name == 'Promise') {
								rez_scope.then(
									function(aVal) {
										console.log('Comm.'+category+'.'+type+' - Fullfilled - rez_scope - ', aVal);
										this[messager_method](payload.cbid, aVal);
									}.bind(this),
									genericReject.bind(null, 'rez_scope', 0)
								).catch(genericCatch.bind(null, 'rez_scope', 0));
							} else {
								this[messager_method](payload.cbid, rez_scope);
							}
						}
					} else if (!payload.method && payload.cbid) {
						// its a cbid
						this.callbackReceptacle[payload.cbid](payload.arg, messageManager, browser, this);
						if (payload.arg && !payload.arg.__PROGRESS) {
							delete this.callbackReceptacle[payload.cbid];
						}
					}
					else { console.error('Comm.'+category+'.'+type+' - invalid combination. method:', payload.method, 'cbid:', payload.cbid, 'payload:', payload); throw new Error('Comm.'+category+'.'+type+' - invalid combination'); }
				}.bind(this)
			};

			this.unregister = function() {
				Comm.unregister_generic(category, type, this);
			};

			gCommContentFrameMessageManager.addMessageListener(aChannelId, this.listener);
		},
		content: function() {
			var type = 'content';
			var category = 'client';
			var scope = gCommScope;
			Comm[category].instances[type].push(this);
			var messager_method = 'putMessage';

			var handshakeComplete = false; // indicates this[messager_method] will now work
			var port;

			this.nextcbid = 1;
			this.callbackReceptacle = {};
			this.reportProgress = function(aProgressArg) {
				aProgressArg.__PROGRESS = 1;
				this.THIS[messager_method](this.cbid, aProgressArg);
			};

			this[messager_method] = function(aMethod, aArg, aCallback) {
				// determine aTransfers
				var aTransfers;
				var xferScope;
				var xferIterable;
				if (aArg) {
					if (aArg.__XFER) {
						xferIterable = aArg.__XFER;
						xferScope = aArg;
					} else if (aArg.a && aArg.m && aArg.a.__XFER) { // special handle for callIn***
						xferIterable = aArg.a.__XFER;
						xferScope = aArg.a;
					}
				}
				if (xferScope) {
					// if want to transfer stuff aArg MUST be an object, with a key __XFER holding the keys that should be transferred
					// __XFER is either array or object. if array it is strings of the keys that should be transferred. if object, the keys should be names of the keys to transfer and values can be anything
					aTransfers = [];
					if (Array.isArray(xferIterable)) {
						for (var p of xferIterable) {
							aTransfers.push(xferScope[p]);
						}
					} else {
						// assume its an object
						for (var p in xferIterable) {
							aTransfers.push(xferScope[p]);
						}
					}
				}

				var cbid = null;
				if (typeof(aMethod) == 'number') {
					// this is a response to a callack waiting in framescript
					cbid = aMethod;
					aMethod = null;
				} else {
					if (aCallback) {
						cbid = this.nextcbid++;
						this.callbackReceptacle[cbid] = aCallback;
					}
				}

				port.postMessage({
					method: aMethod,
					arg: aArg,
					cbid
				}, aTransfers);
			};

			this.listener = function(e) {
				var payload = e.data;
				console.log('Comm.'+category+'.'+type+' - incoming, payload:', payload); // , 'e:', e, 'this:', this);

				if (payload.method) {
					if (!(payload.method in scope)) { console.error('Comm.'+category+'.'+type+' - method of "' + payload.method + '" not in WINDOW'); throw new Error('method of "' + payload.method + '" not in WINDOW') } // dev line remove on prod
					var rez_scope = scope[payload.method](payload.arg, payload.cbid ? this.reportProgress.bind({THIS:this, cbid:payload.cbid}) : undefined, this);
					// in the return/resolve value of this method call in scope, (the rez_blah_call_for_blah = ) MUST NEVER return/resolve an object with __PROGRESS:1 in it
					// console.log('Comm.'+category+'.'+type+' - rez_scope:', rez_scope);
					if (payload.cbid) {
						if (rez_scope && rez_scope.constructor.name == 'Promise') {
							rez_scope.then(
								function(aVal) {
									console.log('Comm.'+category+'.'+type+' - Fullfilled - rez_scope - ', aVal);
									this[messager_method](payload.cbid, aVal);
								}.bind(this),
								genericReject.bind(null, 'rez_scope', 0)
							).catch(genericCatch.bind(null, 'rez_scope', 0));
						} else {
							this[messager_method](payload.cbid, rez_scope);
						}
					}
				} else if (!payload.method && payload.cbid) {
					// its a cbid
					this.callbackReceptacle[payload.cbid](payload.arg, this);
					if (payload.arg && !payload.arg.__PROGRESS) {
						delete this.callbackReceptacle[payload.cbid];
					}
				}
				else { console.error('Comm.'+category+'.'+type+' - invalid combination. method:', payload.method, 'cbid:', payload.cbid, 'payload:', payload); throw new Error('Comm.'+category+'.'+type+' - invalid combination'); }
			}.bind(this);

			this.unregister = function() {
				Comm.unregister_generic(category, type, this);
			};

			var winMsgListener = function(e) {
				var data = e.data;
				// console.log('Comm.'+category+'.'+type+' - incoming window message, data:', uneval(data)); //, 'source:', e.source, 'ports:', e.ports);
				switch (data.topic) {
					case 'contentComm_handshake':

							window.removeEventListener('message', winMsgListener, false);
							port = data.port2;
							port.onmessage = this.listener;
							this[messager_method]('Comm.'+category+'.'+type+' - contentComm_handshake_finalized');
							handshakeComplete = true;
							if (onHandshakeComplete) {
								onHandshakeComplete(true);
							}
						break; default: console.error('Comm.'+category+'.'+type+' - unknown topic, data:', data);
				}
			}.bind(this);

			window.addEventListener('message', winMsgListener, false);
		},
		instances: {worker:[], framescript:[], content:[]},
		unregAll: function(aType) {
			var category = 'client';
			var type_instances_clone = Comm[category].instances[aType].slice(); // as the .unregister will remove it from the original array

			var l = type_instances_clone.length;
			for (var inst of type_instances_clone) {
				inst.unregister();
			}
		}
	},
	callInX: function(aCommTo, aCallInMethod, aMethod, aArg, aCallback, aMessageManager) {
		// MUST not be used directly, MUSt have aCommTo and aCallInMethod bounded
		var messagerMethod;
		if (aCommTo.copyMessage) {
			if (aMessageManager) {
				// server - so this is bootstrap obviously
				messagerMethod = aCommTo.copyMessage.bind(aCommTo, aMessageManager);
			} else {
				// client
				messagerMethod = aCommTo.copyMessage;
			}
		} else {
			messagerMethod = aCommTo.putMessage;
		}

		if (aMethod.constructor.name == 'Object') {
			var aReportProgress = aArg;
			var aCommFrom = aCallback;
			var {m:aMethod, a:aArg} = aMethod;
			if (!aCallInMethod) {
				if (aReportProgress) { // if it has aReportProgress then the scope has a callback waiting for reply
					var deferred = new Deferred();
					messagerMethod(aMethod, aArg, function(rez) {
						if (rez && rez.__PROGRESS) {
							aReportProgress(rez);
						} else {
							deferred.resolve(rez);
						}
					});
					return deferred.promise;
				} else {
					messagerMethod(aMethod, aArg);
				}
			} else {
				if (aReportProgress) { // if it has aReportProgress then the scope has a callback waiting for reply
					var deferred = new Deferred();
					messagerMethod(aCallInMethod, {
						m: aMethod,
						a: aArg
					}, function(rez) {
						if (rez && rez.__PROGRESS) {
							aReportProgress(rez);
						} else {
							deferred.resolve(rez);
						}
					});
					return deferred.promise;
				} else {
					messagerMethod(aCallInMethod, {
						m: aMethod,
						a: aArg
					});
				}
			}
		} else {
			if (!aCallInMethod) {
				messagerMethod(aMethod, aArg, aCallback);
			} else {
				messagerMethod(aCallInMethod, {
					m: aMethod,
					a: aArg
				}, aCallback);
			}
		}
	}
};

var CommHelper = {
	cache: {},
	bootstrap: {
		get callInMainworker() {
			if (!CommHelper.cache.callInMainworker) {
				CommHelper.cache.callInMainworker = Comm.callInX.bind(null, gWkComm, null);
			}
			return CommHelper.cache.callInMainworker;
		},
		get callInContent1() {
			if (!CommHelper.cache.callInContent1) {
				CommHelper.cache.callInContent1 = Comm.callInX.bind(null, gBlahComm1, null);
			}
			return CommHelper.cache.callInContent1;
		},
		get callInContentinframescript() {
			if (!CommHelper.cache.callInContentinframescript) {
				CommHelper.cache.callInContentinframescript = Comm.callInX.bind(null, gFsComm, 'callInContent');
			}
			return CommHelper.cache.callInContentinframescript;
		},
		get callInFramescript() {
			if (!CommHelper.cache.callInFramescript) {
				CommHelper.cache.callInFramescript = Comm.callInX.bind(null, gFsComm, null);
			}
			return CommHelper.cache.callInFramescript;
		}
	},
	mainworker: {
		get callInBootstrap() {
			if (!CommHelper.cache.callInBootstrap) {
				CommHelper.cache.callInBootstrap = Comm.callInX.bind(null, gBsComm, null);
			}
			return CommHelper.cache.callInBootstrap;
		},
		get callInChildworker1() {
			if (!CommHelper.cache.callInChildworker1) {
				CommHelper.cache.callInChildworker1 = Comm.callInX.bind(null, gBlahComm1, null);
			}
			return CommHelper.cache.callInChildworker1;
		}
	},
	childworker: {
		get callInMainworker() {
			if (!CommHelper.cache.callInMainworker) {
				CommHelper.cache.callInMainworker = Comm.callInX.bind(null, gWkComm, null);
			}
			return CommHelper.cache.callInMainworker;
		},
		get callInBootstrap() {
			if (!CommHelper.cache.callInBootstrap) {
				CommHelper.cache.callInBootstrap = Comm.callInX.bind(null, gWkComm, 'callInBootstrap');
			}
			return CommHelper.cache.callInBootstrap;
		}
	},
	content: {
		get callInMainworker() {
			if (!CommHelper.cache.callInMainworker) {
				CommHelper.cache.callInMainworker = Comm.callInX.bind(null, gBsComm, 'callInMainworker');
			}
			return CommHelper.cache.callInMainworker;
		},
		get callInBootstrap() {
			if (!CommHelper.cache.callInBootstrap) {
				CommHelper.cache.callInBootstrap = Comm.callInX.bind(null, gBsComm, null);
			}
			return CommHelper.cache.callInBootstrap;
		}
	},
	framescript: {
		get callInBootstrap() {
			if (!CommHelper.cache.callInBootstrap) {
				console.error('from Comm.js, gBsComm:', gBsComm, 'rawr:', rawr);
				CommHelper.cache.callInBootstrap = Comm.callInX.bind(null, gBsComm, null);
			}
			return CommHelper.cache.callInBootstrap;
		},
		get callInContent() {
			if (!CommHelper.cache.callInContent) {
				CommHelper.cache.callInContent = Comm.callInX.bind(null, gWinComm, null);
			}
			return CommHelper.cache.callInContent;
		},
		get callInMainworker() {
			if (!CommHelper.cache.callInMainworker) {
				CommHelper.cache.callInMainworker = Comm.callInX.bind(null, gBsComm, 'callInMainworker');
			}
			return CommHelper.cache.callInMainworker;
		}
	},
	contentinframescript: {
		get callInFramescript() {
			if (!CommHelper.cache.callInFramescript) {
				CommHelper.cache.callInFramescript = Comm.callInX.bind(null, gFsComm, null);
			}
			return CommHelper.cache.callInFramescript;
		},
		get callInMainworker() {
			if (!CommHelper.cache.callInMainworker) {
				CommHelper.cache.callInMainworker = Comm.callInX.bind(null, gFsComm, 'callInMainworker');
			}
			return CommHelper.cache.callInMainworker;
		},
		get callInBootstrap() {
			if (!CommHelper.cache.callInBootstrap) {
				CommHelper.cache.callInBootstrap = Comm.callInX.bind(null, gFsComm, 'callInBootstrap');
			}
			return CommHelper.cache.callInBootstrap;
		}
	}
};

/*
// these helpers are placed in the respecting scope. like bootstrap section are all methods to be placed in bootstrap
// all helpers have 3 arguments, aMethod, aArg, aCallback EXCEPT for callInFramescript which has 4th arg of aMessageManager
helper: {
	bootstrap: {
		callInMainworker: Comm.callInX.bind(null, gWkComm, null),
		callInContent1: Comm.callInX.bind(null, gBlahComm1, null),
		callInContentinframescript: Comm.callInX.bind(null, gFsComm, 'callInContent'),
		callInFramescript: Comm.callInX.bind(null, gFsComm, null)
	},
	mainworker: {
		callInBootstrap: Comm.callInX.bind(null, gBsComm, null),
		callInChildworker1: Comm.callInX.bind(null, gBlahComm1, null)
	},
	childworker: {
		callInMainworker: Comm.callInX.bind(null, gWkComm, null),
		callInBootstrap: Comm.callInX.bind(null, gWkComm, 'callInBootstrap')
	},
	content: {
		callInMainworker: Comm.callInX.bind(null, gBsComm, 'callInMainworker'),
		callInBootstrap: Comm.callInX.bind(null, gBsComm, null)
	},
	framescript: {
		callInBootstrap: Comm.callInX.bind(null, gBsComm, null),
		callInContent: Comm.callInX.bind(null, gWinComm, null),
		callInMainworker: Comm.callInX.bind(null, gBsComm, 'callInMainworker')
	},
	contentinframescript: {
		callInFramescript: Comm.callInX.bind(null, gFsComm, null),
		callInMainworker: Comm.callInX.bind(null, gFsComm, 'callInMainworker'),
		callInBootstrap: Comm.callInX.bind(null, gFsComm, 'callInBootstrap')
	}
}
*/
