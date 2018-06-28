import React, { Component } from 'react';
import web3, { initWeb3 } from  '../web3';

const settings = require('../settings');

const otcABI = require('../abi/otc').abi;
const otcSupportMethodsABI = require('../abi/otcSupportMethods').abi;

class App extends Component {
  constructor() {
    super();
    const initialState = this.getInitialState();
    this.state = {
      ...initialState,
      network: {},
    }
  }

  getInitialState = () => {
    return {
      sellOffersOrder: [],
      sellOffers: {},
      buyOffersOrder: [],
      buyOffers: {}
    };
  }

  checkNetwork = () => {
    web3.version.getNode(error => {
      const isConnected = !error;

      // Check if we are synced
      if (isConnected) {
        web3.eth.getBlock('latest', (e, res) => {
          if (typeof(res) === 'undefined') {
            console.debug('YIKES! getBlock returned undefined!');
          }
          if (res.number >= this.state.network.latestBlock) {
            const networkState = { ...this.state.network };
            networkState.latestBlock = res.number;
            networkState.outOfSync = e != null || ((new Date().getTime() / 1000) - res.timestamp) > 600;
            this.setState({ network: networkState });
          } else {
            // XXX MetaMask frequently returns old blocks
            // https://github.com/MetaMask/metamask-plugin/issues/504
            console.debug('Skipping old block');
          }
        });
      }

      // Check which network are we connected to
      // https://github.com/ethereum/meteor-dapp-wallet/blob/90ad8148d042ef7c28610115e97acfa6449442e3/app/client/lib/ethereum/walletInterface.js#L32-L46
      if (this.state.network.isConnected !== isConnected) {
        if (isConnected === true) {
          web3.eth.getBlock(0, (e, res) => {
            let network = false;
            if (!e) {
              switch (res.hash) {
                case '0xa3c565fc15c7478862d50ccd6561e3c06b24cc509bf388941c25ea985ce32cb9':
                  network = 'kovan';
                  break;
                case '0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3':
                  network = 'main';
                  break;
                default:
                  console.log('setting network to private');
                  console.log('res.hash:', res.hash);
                  network = 'private';
              }
            }
            if (this.state.network.network !== network) {
              this.initNetwork(network);
            }
          });
        } else {
          const networkState = { ...this.state.network };
          networkState.isConnected = isConnected;
          networkState.network = false;
          networkState.latestBlock = 0;
          this.setState({ network: networkState });
        }
      }
    });
  }

  initNetwork = newNetwork => {
    //checkAccounts();
    const networkState = { ...this.state.network };
    networkState.network = newNetwork;
    networkState.isConnected = true;
    networkState.latestBlock = 0;
    this.setState({ network: networkState }, () => {
      const addrs = settings.chain[this.state.network.network];
      this.initContracts(addrs.top);
    });
  }

  checkAccounts = (checkAccountChange = true) => {
    web3.eth.getAccounts(async (error, accounts) => {
      if (!error) {
        const ledgerWallet = this.state.network.isLedger ? (await this.initLedger()).toLowerCase() : '';
        let oldDefaultAccount = '';
        this.setState(prevState => {
          const network = {...prevState.network};
          const profile = {...prevState.profile};
          network.accounts = accounts;
          oldDefaultAccount = network.defaultAccount;
          network.defaultAccount = ledgerWallet ? ledgerWallet : accounts[0];
          profile.activeProfile = network.defaultAccount;
          network.isLedger = ledgerWallet !== '';
          web3.eth.defaultAccount = network.defaultAccount;
          return {network, profile}
        }, () => {
          if (checkAccountChange && oldDefaultAccount !== this.state.network.defaultAccount) {
            this.initContracts(this.state.system.top.address);
          }
        });
      }
    });
  }

  componentDidMount = () => {
    setTimeout(this.init, 500);
  }

  init = async () => {
    initWeb3(web3);

    this.checkNetwork();
    this.checkAccounts(false);
    this.checkAccountsInterval = setInterval(this.checkAccounts, 10000);
    this.checkNetworkInterval = setInterval(this.checkNetwork, 3000);
  }

  loadObject = (abi, address) => {
    return web3.eth.contract(abi).at(address);
  }

  removeDuplicates = arr => {
    let unique_array = []
    for(let i = 0;i < arr.length; i++){
        if(unique_array.indexOf(arr[i]) === -1){
            unique_array.push(arr[i])
        }
    }
    return unique_array
}

  getOffers = (type, e, r) => {
    const getOffer = id => {
      return new Promise((resolve, reject) => {
        this.otc.offers(id, (e, r) => {
          if (!e) {
            resolve(r);
          } else {
            reject(e);
          }
        })
      });
    }

    if (!e) {
      const promises = [];
      for (let i = 0; i < r.length; i++) {
        promises.push(getOffer(r[i]));
      }
      this.setState(prevState => {
        let offersOrder = [...prevState[`${type}OffersOrder`]];
        offersOrder = offersOrder.concat(r.map(val => val.toNumber()));
        prevState[`${type}OffersOrder`] = this.removeDuplicates(offersOrder);
        return prevState;
      }, () => {
        if (this.state[`${type}OffersOrder`][this.state[`${type}OffersOrder`].length - 1]) {
          this.otcSupportMethodsObj.getOffers['address,uint256'](this.otc.address, this.state[`${type}OffersOrder`][this.state[`${type}OffersOrder`].length - 1], (e, r) => {
            this.getOffers(e, r);
          });
        }
      });
      Promise.all(promises).then(r2 => {
        const newOffers = {};
        Object.keys(r2).forEach(key => {
          newOffers[r[key]] = r2[key];
        });
        this.setState(prevState => {
          let offers = [...prevState[`${type}Offers`]];
          offers = {...offers, ...newOffers};
          prevState[`${type}Offers`] = offers;
          return prevState;
        });
      });
    }
  }

  initContracts = () => {
    this.otc = this.loadObject(otcABI, settings.chain[this.state.network.network].otc);
    this.otcSupportMethodsObj = this.loadObject(otcSupportMethodsABI, settings.chain[this.state.network.network].otcSupportMethods);
    
    this.otcSupportMethodsObj.getOffers['address,address,address'](this.otc.address, settings.chain[this.state.network.network].weth, settings.chain[this.state.network.network].dai, (e, r) => {
      this.getOffers('sell', e, r);
    });
    this.otcSupportMethodsObj.getOffers['address,address,address'](this.otc.address, settings.chain[this.state.network.network].dai, settings.chain[this.state.network.network].weth, (e, r) => {
      this.getOffers('buy', e, r);
    });
  }

  valueOf = number => {
    return number ? number.valueOf() : 0;
  } 

  render() {
    return (
      <div>
        <div style={ {width: '50%', float: 'left'} }>
          <h2>Buy DAI Orders</h2>
          {
            Object.keys(this.state.buyOffers).length > 0 &&
            this.state.buyOffersOrder.map(offerId =>
              {
                return this.state.buyOffers[offerId] &&
                <div key={ offerId } style={ {marginBottom: '10px', border: '1px solid'} }>
                  { offerId } - { this.valueOf(this.state.buyOffers[offerId][0]) } - { this.state.buyOffers[offerId][1] } - { this.valueOf(this.state.buyOffers[offerId][2]) } - { this.state.buyOffers[offerId][3] } - { this.state.buyOffers[offerId][4] } - { (new Date(this.valueOf(this.state.buyOffers[offerId][5]) * 1000).toString()) }
                </div>
              }
            )
          }
        </div>
        <div style={ {width: '50%', float: 'right'} }>
          <h2>Sell DAI Orders</h2>
          {
            Object.keys(this.state.sellOffers).length > 0 &&
            this.state.sellOffersOrder.map(offerId =>
              {
                return this.state.sellOffers[offerId] &&
                <div key={ offerId } style={ {marginBottom: '10px', border: '1px solid'} }>
                  { offerId } - { this.valueOf(this.state.sellOffers[offerId][0]) } - { this.valueOf(this.state.sellOffers[offerId][2]) } - { this.state.sellOffers[offerId][4] } - { (new Date(this.valueOf(this.state.sellOffers[offerId][5]) * 1000).toString()) }
                </div>
              }
            )
          }
        </div>
      </div>
    );
  }
}

export default App;
