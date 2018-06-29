import React, { Component } from 'react';
import web3, { initWeb3 } from  '../web3';

const settings = require('../settings');

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
      sellOffers: [],
      buyOffers: []
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

  getOffers = (type, e, r) => {
    if (!e) {
      const newOffers = [];
      let arrayCompleted = true;
      const prevOffers = [...this.state[`${type}Offers`]];

      for (let i = 0; i < r.length; i = i + 5) {
        if (r[i] === '0x0000000000000000000000000000000000000000000000000000000000000000') {
          arrayCompleted = false;
          break;
        }
        if (prevOffers.length === 0 || i > 0 || prevOffers[prevOffers.length - 1].offerId !== parseInt(r[i], 16)) {
          // Avoid inserting a duplicated offer when bringing more than 1 batch of offers
          newOffers.push ({
            offerId: parseInt(r[i], 16),
            payAmt: web3.toBigNumber(r[i + 1]),
            buyAmt: web3.toBigNumber(r[i + 2]),
            owner: `0x${r[i + 3].slice(26, r[i + 3].length)}`,
            date: new Date(this.valueOf(parseInt(r[i + 4], 16)) * 1000).toString()
          });
        }
      }
      this.setState(prevState => {
        let offers = [...prevState[`${type}Offers`]];
        offers = offers.concat(newOffers);
        prevState[`${type}Offers`] = offers;
        return prevState;
      }, () => {
        if (arrayCompleted) {
          this.otcSupportMethodsObj.getOffers['address,uint256'](settings.chain[this.state.network.network].otc, this.state[`${type}Offers`][this.state[`${type}Offers`].length - 1].offerId, (e, r) => {
            this.getOffers(e, r);
          });
        }
      });
    }
  }

  initContracts = () => {
    this.otcSupportMethodsObj = this.loadObject(otcSupportMethodsABI, settings.chain[this.state.network.network].otcSupportMethods);
    
    this.otcSupportMethodsObj.getOffers['address,address,address'](settings.chain[this.state.network.network].otc, settings.chain[this.state.network.network].weth, settings.chain[this.state.network.network].dai, (e, r) => {
      this.getOffers('sell', e, r);
    });
    this.otcSupportMethodsObj.getOffers['address,address,address'](settings.chain[this.state.network.network].otc, settings.chain[this.state.network.network].dai, settings.chain[this.state.network.network].weth, (e, r) => {
      this.getOffers('buy', e, r);
    });
  }

  valueOf = number => {
    return number ? web3.fromWei(number).valueOf() : 0;
  } 

  render() {
    return (
      <div>
        <div style={ {width: '50%', float: 'left'} }>
          <h2>Buy DAI Orders ({ this.state.buyOffers.length })</h2>
          {
            this.state.buyOffers.map(offer =>
              <div key={ offer.offerId } style={ {marginBottom: '10px', border: '1px solid'} }>
                { offer.offerId } - { this.valueOf(offer.payAmt) } - { this.valueOf(offer.buyAmt) } - { offer.owner } - { offer.date }
              </div>
            )
          }
        </div>
        <div style={ {width: '50%', float: 'right'} }>
          <h2>Sell DAI Orders ({ this.state.sellOffers.length })</h2>
          {
            this.state.sellOffers.map(offer =>
              <div key={ offer.offerId } style={ {marginBottom: '10px', border: '1px solid'} }>
                { offer.offerId } - { this.valueOf(offer.payAmt) } - { this.valueOf(offer.buyAmt) } - { offer.owner } - { offer.date }
              </div>
            )
          }
        </div>
      </div>
    );
  }
}

export default App;
