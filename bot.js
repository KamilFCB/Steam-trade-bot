let SteamTotp = require('steam-totp');
let Steam = require('steam');
let SteamTradeOffers = require('steam-tradeoffers');
let mysql = require('mysql');
let SteamCommunity = require('steamcommunity');
let TradeOfferManager = require('steam-tradeoffer-manager');


const admin = ''; // main account steam id
const sharedSecret = ''; // bot's account shared secret
const identitySecret = ''; // bot's account identity secret
const apiKey = ''; // bot's account api key

let logOnOptions = {
    accountName: '', //bot's steam account login
    password: '', // bot's steam account password
    twoFactorCode: SteamTotp.generateAuthCode(sharedSecret)
};

const mysqlInfo = {
    host: '',
    user: '',
    password: '',
    database: '',
    charset: 'utf8_general_ci'
};

let mysqlConnection = mysql.createPool(mysqlInfo);

mysqlConnection.getConnection((err) => {
    if(err){
        console.log(err);
        reconnect(mysqlConnection);
    }
})

function reconnect(connection) {
    connection = mysql.createPool(mysqlInfo);

    connection.getConnection((err) => {
        if(err)
            setTimeout(reconnect(connection), 2000);
        
        return connection;
    });
}

let community = new SteamCommunity();
let manager = new TradeOfferManager({
    "community": community
});
let steam = new Steam.SteamClient();
let offers = new SteamTradeOffers();

(function loginIn() {
    community.login(logOnOptions, (err, sessionID, cookies, steamguard, oAuthToken) => {
        if (err)
            console.log(err);
        else {
            community.oAuthLogin(steamguard, oAuthToken, (err) => {
                if (err)
                    console.log(err);
            });
            offers.setup({
                sessionID: sessionID,
                webCookie: cookies,
                APIKey: apiKey
            },  (err) => {
                if (err)
                    console.log(err);
                });
            manager.setCookies(cookies);
        }
    });

    community.chatLogon(500, 'web');
    community.loggedIn((err, loggedIn) => {
        if(err)
            console.log(err);
        if(loggedIn)
            console.log("Logged in");
    })
})();


function confirmOffer() {
    let time = SteamTotp.time();
    let confKey = SteamTotp.getConfirmationKey(identitySecret, time, "conf");
    let allowKey = SteamTotp.getConfirmationKey(identitySecret, time, "allow");

    community.getConfirmations(time, confKey, (err, confirmations) => {
        if(err)
        {
            console.log(err);
            return;
        }
        for(let i=0; i<confirmations.length; i++)
        {
            confirmations[i].respond(time, allowKey, true, (err) => {
                if(err)
                {
                    console.log(err);
                    return;
                }
                console.log("Offer confirmed");
            });
        }
    });
}

// offers accepting
manager.on('newOffer', function(offer){
    if (offer.state === 2)
    {
        if (offer.partner.getSteamID64() === admin)
        {
            offer.accept(function(err, status){
                if(err)
                    console.log(err);
                else
                    console.log("Offer accepted, status: " + status);
            });
        }
    }
});

manager.on('unknownOfferSent', (offer) => {
    console.log("New offer sent");
    switch (offer.state)
    {
        case 4:
        case 2:
        case 9:
            community.loggedIn((err, loggedIn) => {
            if(err)
                console.log(err);
            if(loggedIn)
                confirmOffer();
            });
            mysqlConnection.query("UPDATE `droped` SET `status`= 3 WHERE `hash` = '" + offer.message + "';", () => {});
            console.log("Accepted");
            break;
        case 1:
        case 5:
        case 6:
        case 7:
        case 8:
        case 10:
            mysqlConnection.query("UPDATE `droped` SET `status`= 0 WHERE `hash` = '" + offer.message + "';", () => {});
            console.log('Offer rejected');
            break;
        case 3:
            mysqlConnection.query("UPDATE `droped` SET `status`= 4 WHERE `hash` = '" + offer.message + "';", () => {});
            console.log('Offer accepted');
            break;
        default:
            console.log("ERROR");
    }
});

manager.on('sentOfferChanged', (offer) => {
    switch (offer.state)
    {
        case 4:
        case 2:
        case 9:
            community.loggedIn((err, loggedIn) => {
            if(err)
                console.log(err);
            if(loggedIn)
                confirmOffer();
            });
            mysqlConnection.query("UPDATE `droped` SET `status`= 3 WHERE `hash` = '" + offer.message + "';", () => {});
            console.log("Accepted");
            break;
        case 1:
        case 5:
        case 6:
        case 7:
        case 8:
        case 10:
            mysqlConnection.query("UPDATE `droped` SET `status`= 0 WHERE `hash` = '" + offer.message + "';", () => {});
            console.log('Offer rejected');
            break;
        case 3:
            mysqlConnection.query("UPDATE `droped` SET `status`= 4 WHERE `hash` = '" + offer.message + "';", () => {});
            console.log('Offer accepted');
            break;
        default:
            console.log("ERROR");
    }
});

function sendOffers() {
    mysqlConnection.query('SELECT droped.id, droped.hash, steam_connect.partnerId, steam_connect.token, item.name, droped.status FROM `droped` JOIN steam_connect ON droped.uid=steam_connect.uid JOIN item ON droped.item_id=item.id where droped.status=2 AND item.sell_price > 5 AND steam_connect.partnerId != "" AND steam_connect.token != ""', (err, row) => {
        if(err) {
            console.log(err);
            return;
        }
        if(row.length === 0)
            return;

        manager.getInventoryContents(730, 2, false, (err, inventory) => {
            if(err) {
                console.log(err);
                return;
            }

            for(let z=0; z < row.length; z++) {
                let item = [];
                let sendId = row[z].id;
                
                for(let i=0; i < inventory.length; i++) {
                    if(inventory[i].name === row[z].name && inventory[i].tradable) {
                        item[0]={
                            appid: 730,
                            contextid: 2,
                            amount: inventory[i].amount,
                            assetid: inventory[i].assetid
                        };
                        offers.makeOffer ({
                            partnerAccountId: row[z].partnerId,
                            itemsFromMe: item,
                            accessToken: row[z].token,
                            itemsFromThem: [],
                            message: row[z].hash
                        }, (err) => {
                            if(err) {
                                console.log(err);
                                return;
                            }
                            mysqlConnection.query("UPDATE `droped` SET `status`=3 WHERE `id`='" +gamenum+ "';", () => {});
                            console.log('Trade offer for queue '+sendId+' sent!');
                        });
                        break;
                    }
                }
            }
        });
    });
}

setInterval(() => {
    sendOffers();
}, 60000);