const express = require('express')
const app = express()
const bodyParser = require('body-parser')
var cors = require("cors");
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json())
app.use(cors());
const atomicassets_account = "atomicassets";
const federation_account = "federation";
const mining_account = "m.federation";
const token_account = "alien.worlds";
const collection = "alien.worlds";
const endpoint = "https://wax.greymass.com"; //
const atomic_endpoint = ['https://wax.api.atomicassets.io', 'https://wax3.api.atomicassets.io'];
const { Api, JsonRpc, RpcError, Serialize } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');      // development only
const fetch = require('node-fetch');                                    // node only; not needed in browsers
const { ExplorerApi, RpcApi } = require("atomicassets");
const eos_rpc = new JsonRpc(endpoint, { fetch });
const aa_api = new ExplorerApi(atomic_endpoint[0], atomicassets_account, {
    fetch,
    rateLimit: 4,
});

const { TextDecoder, TextEncoder } = require(/*! text-encoding */ "text-encoding");
const Int64LE = require(/*! int64-buffer */ "int64-buffer").Int64LE;
const crypto = require("crypto");
const Buffer = require('buffer').Buffer  // note: the trailing slash is important!
const Blob = require('blob');

const ac = require("@antiadmin/anticaptchaofficial");

app.get('/', (req, res) => {
    res.json({ account: "Hello World" })  // <==== req.body will be a parsed JSON object
})

app.post('/worker', async (req, res) => {
    const { account, DiffBagLand, last_mine_tx } = req.body
    const mine_work = await background_mine(account, DiffBagLand, last_mine_tx);
    res.json(mine_work)
    // res.json({account: account})  // <==== req.body will be a parsed JSON object
})

app.listen(3000, () => {
    console.log('Start server at port 3000.')
})


const getMineDelay = async function (account) {
    try {
        const bag = await getBag(mining_account, account, wax.api.rpc, aa_api);
        const land = await getLand(
            federation_account,
            mining_account,
            account,
            wax.api.rpc,
            aa_api
        );
        const params = getBagMiningParams(bag);
        const land_params = getLandMiningParams(land);
        params.delay *= land_params.delay / 10;
        params.difficulty += land_params.difficulty;
        var minedelay = await getNextMineDelay(
            mining_account,
            account,
            params,
            wax.api.rpc
        );
        return minedelay;
    } catch (error) {
        return error;
    }
};





//Function Call 


/* Utility functions */
const getRand = () => {
    const arr = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
        const rand = parseInt(Math.floor(Math.random() * 255));
        arr[i] = rand;
    }
    return arr;
};

const pushRand = (sb) => {
    const arr = getRand();
    sb.pushArray(arr);
    return arr;
};


/* uint8array to / from hex strings */
const fromHexString = hexString =>
    new Uint8Array(hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

const toHexString = bytes =>
    bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');

const nameToInt = (name) => {
    const sb = new Serialize.SerialBuffer({
        textEncoder: new TextEncoder,
        textDecoder: new TextDecoder
    });

    sb.pushName(name);

    const name_64 = new Int64LE(sb.array);

    return name_64 + '';
}

const nameToArray = (name) => {
    const sb = new Serialize.SerialBuffer({
        textEncoder: new TextEncoder,
        textDecoder: new TextDecoder
    });

    sb.pushName(name);

    return sb.array;
}

const intToName = (int) => {
    int = new Int64LE(int);

    const sb = new Serialize.SerialBuffer({
        textEncoder: new TextEncoder,
        textDecoder: new TextDecoder
    });

    sb.pushArray(int.toArray());

    const name = sb.getName();

    return name;
}



const getBag = async (mining_account, account, eos_rpc, aa_api) => {
    const bag_res = await eos_rpc.get_table_rows({ code: mining_account, scope: mining_account, table: 'bags', lower_bound: account, upper_bound: account });
    const bag = [];
    if (bag_res.rows.length) {
        const items_p = bag_res.rows[0].items.map((item_id) => {
            return aa_api.getAsset(item_id);
        });
        return await Promise.all(items_p);
    }
    return bag;
}

const setBag = async (mining_account, account, items, eos_api, permission = 'active') => {
    const actions = [{
        account: mining_account,
        name: 'setbag',
        authorization: [{
            actor: account,
            permission: permission,
        }],
        data: {
            account,
            items: items.slice(0, 3)
        }
    }];
    const res = await eos_api.transact({
        actions
    }, {
        blocksBehind: 3,
        expireSeconds: 90,
    });

    return res;
}

const getLandById = async (federation_account, land_id, eos_rpc, aa_api) => {
    try {
        const land_res = await eos_rpc.get_table_rows({ code: federation_account, scope: federation_account, table: 'landregs', lower_bound: land_id, upper_bound: land_id });
        let landowner = 'federation';
        if (land_res.rows.length) {
            landowner = land_res.rows[0].owner;
        }

        if (!landowner) {
            throw new Error(`Land owner not found for land id ${land_id}`);
        }

        const land_asset = await aa_api.getAsset(land_id);
        // const land_data = await land_asset.toObject();

        land_asset.data.planet = intToName(land_asset.data.planet);

        // make sure these attributes are present
        land_asset.data.img = land_asset.data.img || '';
        land_asset.owner = land_asset.owner || landowner;

        return land_asset;
    }
    catch (e) {
        console.log(`Error in getLandById ${e.message}`);
        return null;
    }
}

const getLand = async (federation_account, mining_account, account, eos_rpc, aa_api) => {
    try {
        const miner_res = await eos_rpc.get_table_rows({ code: mining_account, scope: mining_account, table: 'miners', lower_bound: account, upper_bound: account });
        let land_id;
        if (miner_res.rows.length === 0) {
            return null;
        }
        else {
            land_id = miner_res.rows[0].current_land;
        }

        return await getLandById(federation_account, land_id, eos_rpc, aa_api);
    }
    catch (e) {
        console.error(`Failed to get land - ${e.message}`);
        return null;
    }
}


const getLandMiningParams = (land) => {
    const mining_params = {
        delay: 0,
        difficulty: 0,
        ease: 0
    };

    mining_params.delay += land.data.delay;
    mining_params.difficulty += land.data.difficulty;
    mining_params.ease += land.data.ease;

    return mining_params;
};

const getBagMiningParams = (bag) => {
    const mining_params = {
        delay: 0,
        difficulty: 0,
        ease: 0
    };

    let min_delay = 65535;

    for (let b = 0; b < bag.length; b++) {
        if (bag[b].data.delay < min_delay) {
            min_delay = bag[b].data.delay;
        }
        mining_params.delay += bag[b].data.delay;
        mining_params.difficulty += bag[b].data.difficulty;
        mining_params.ease += bag[b].data.ease / 10;
    }

    if (bag.length === 2) {
        mining_params.delay -= parseInt(min_delay / 2);
    }
    else if (bag.length === 3) {
        mining_params.delay -= min_delay;
    }

    return mining_params;
};

/* Return number of ms before we can next mine */
const getNextMineDelay = async (account, params) => {
    const state_res = await eos_rpc.get_table_rows({
        code: mining_account,
        scope: mining_account,
        table: 'miners',
        lower_bound: account,
        upper_bound: account
    });

    let ms_until_mine = -1;
    const now = new Date().getTime();
    console.log(`Delay = ${params.delay}`);

    if (state_res.rows.length && state_res.rows[0].last_mine_tx !== '0000000000000000000000000000000000000000000000000000000000000000') {
        console.log(`Last mine was at ${state_res.rows[0].last_mine}, now is ${new Date()}`);
        const last_mine_ms = Date.parse(state_res.rows[0].last_mine + '.000Z');
        ms_until_mine = last_mine_ms + (params.delay * 1000) - now;
        console.log(ms_until_mine);
        if (ms_until_mine < 0) {
            ms_until_mine = 0;
        }
    }
    console.log(`ms until next mine ${ms_until_mine}`);

    return ms_until_mine;
};



// Calculate Nonce 

const background_mine = async (account, difficulty, last_mine_tx) => {
    // const bagDifficulty = await getBagDifficulty(account);
    // const landDifficulty = await getLandDifficulty(account);
    // const difficulty = bagDifficulty + landDifficulty;
    // console.log('difficulty', difficulty);

    // console.log('start doWork = ' + Date.now());
    // const last_mine_tx = await lastMineTx(mining_account, account, eos_rpc);


    const MineWork = setHash({ mining_account, account, difficulty, last_mine_tx });
    // console.log(MineWork);
    return MineWork;
};

const setHash = async (mining_params) => {
    mining_params.last_mine_tx = mining_params.last_mine_tx.substr(0, 16); // only first 8 bytes of txid
    mining_params.last_mine_arr = fromHexString(mining_params.last_mine_tx);

    const sb = new Serialize.SerialBuffer({
        textEncoder: new TextEncoder,
        textDecoder: new TextDecoder
    });
    mining_params.sb = sb;

    mining_params.account_str = mining_params.account;
    mining_params.account = nameToArray(mining_params.account);


    // console.log('mining_params', _message)
    const getRand = () => {
        const arr = new Uint8Array(8);
        for (let i = 0; i < 8; i++) {
            const rand = Math.floor(Math.random() * 255);
            arr[i] = rand;
        }
        return arr;
    };

    const toHex = (buffer) => {
        return [...new Uint8Array(buffer)]
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
    };


    mining_params.account = mining_params.account.slice(0, 8);

    const is_wam = mining_params.account_str.substr(-4) === '.wam';

    let good = false, itr = 0, rand = 0, hash, hex_digest, rand_arr, last;

    console.log(`Performing work with difficulty ${mining_params.difficulty}, last tx is ${mining_params.last_mine_tx}...`);
    if (is_wam) {
        console.log(`Using WAM account`);
    }

    const start = (new Date()).getTime();

    while (!good) {
        rand_arr = getRand();

        // console.log('combining', mining_params.account, mining_params.last_mine_arr, rand_arr);
        const combined = new Uint8Array(mining_params.account.length + mining_params.last_mine_arr.length + rand_arr.length);
        combined.set(mining_params.account);
        combined.set(mining_params.last_mine_arr, mining_params.account.length);
        combined.set(rand_arr, mining_params.account.length + mining_params.last_mine_arr.length);

        hash = crypto.createHash("sha256");
        hash.update(combined.slice(0, 24));
        hex_digest = hash.digest('hex');
        // console.log('combined slice', combined.slice(0, 24))
        // hash = await crypto.subtle.digest('SHA-256', combined.slice(0, 24));
        // console.log(hash);
        // hex_digest = toHex(hash);
        // console.log(hex_digest);
        if (is_wam) {
            // easier for .wam accounts
            good = hex_digest.substr(0, 4) === '0000';
        }
        else {
            // console.log(`non-wam account, mining is harder`)
            good = hex_digest.substr(0, 6) === '000000';
        }

        if (good) {
            if (is_wam) {
                last = parseInt(hex_digest.substr(4, 1), 16);
            }
            else {
                last = parseInt(hex_digest.substr(6, 1), 16);
            }
            good &= (last <= mining_params.difficulty);
            // console.log(hex_digest, good);
        }
        itr++;

        if (itr % 1000000 === 0) {
            console.log(`Still mining - tried ${itr} iterations`);
            const mine_work = { account: mining_params.account_str, rand_str: "0", hex_digest: "0" };
            return mine_work;
        }

        if (!good) {
            hash = null;
        }

    }
    const end = (new Date()).getTime();

    // console.log(sb.array.slice(0, 20));
    // const rand_str = Buffer.from(sb.array.slice(16, 24)).toString('hex');
    const rand_str = toHex(rand_arr);

    console.log(`Found hash in ${itr} iterations with ${mining_params.account} ${rand_str}, last = ${last}, hex_digest ${hex_digest} taking ${(end - start) / 1000}s`)
    const mine_work = { account: mining_params.account_str, rand_str, hex_digest };
    // console.log(mine_work);
    // this.postMessage(mine_work);
    return mine_work;


};


