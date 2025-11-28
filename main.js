import { Buffer } from "buffer";
window.Buffer = window.Buffer || Buffer;

import { ethers } from "ethers";
import { Seaport } from "@opensea/seaport-js";

// ==========================================
// KONFIQURASIYA
// ==========================================

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://azekamo.onrender.com";
const NFT_CONTRACT_ADDRESS = import.meta.env.VITE_NFT_CONTRACT || "0x54a88333F6e7540eA982261301309048aC431eD5";
// Seaport 1.5 Canonical Address
const SEAPORT_CONTRACT_ADDRESS = "0x0000000000000068F116a894984e2DB1123eB395";

const APECHAIN_ID = 33139;
const APECHAIN_ID_HEX = "0x8173";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

// Qlobal Dəyişənlər
let provider = null;
let signer = null;
let seaport = null;
let userAddress = null;

// HTML Elementləri
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const addrSpan = document.getElementById("addr");
const marketplaceDiv = document.getElementById("marketplace");
const noticeDiv = document.getElementById("notice");

// ==========================================
// KÖMƏKÇİ FUNKSİYALAR
// ==========================================

function notify(msg, timeout = 3000) {
  if (!noticeDiv) return;
  noticeDiv.textContent = msg;
  console.log(`[NOTIFY]: ${msg}`);
  if (timeout) setTimeout(() => { if (noticeDiv.textContent === msg) noticeDiv.textContent = ""; }, timeout);
}

function resolveIPFS(url) {
  if (!url) return "https://via.placeholder.com/300?text=No+Image";
  const GATEWAY = "https://cloudflare-ipfs.com/ipfs/";
  if (url.startsWith("ipfs://")) return url.replace("ipfs://", GATEWAY);
  if (url.startsWith("Qm") && url.length >= 46) return `${GATEWAY}${url}`;
  return url;
}

// ⚠️ KRITIK: Orderi Seaport üçün ciddi şəkildə təmizləyən funksiya
function cleanOrder(orderData) {
  const order = orderData.order || orderData;
  const { parameters, signature } = order;

  if (!parameters) return null;

  return {
    parameters: {
      offerer: parameters.offerer,
      zone: parameters.zone,
      offer: parameters.offer.map(item => ({
        itemType: Number(item.itemType), // Mütləq Number
        token: item.token,
        identifierOrCriteria: item.identifierOrCriteria.toString(),
        startAmount: item.startAmount.toString(),
        endAmount: item.endAmount.toString()
      })),
      consideration: parameters.consideration.map(item => ({
        itemType: Number(item.itemType), // Mütləq Number
        token: item.token,
        identifierOrCriteria: item.identifierOrCriteria.toString(),
        startAmount: item.startAmount.toString(),
        endAmount: item.endAmount.toString(),
        recipient: item.recipient
      })),
      orderType: Number(parameters.orderType),
      startTime: parameters.startTime.toString(),
      endTime: parameters.endTime.toString(),
      zoneHash: parameters.zoneHash,
      salt: parameters.salt.toString(),
      conduitKey: parameters.conduitKey,
      totalOriginalConsiderationItems: Number(parameters.totalOriginalConsiderationItems)
    },
    signature: signature
  };
}

// JSON çevirmə zamanı BigInt xətalarını qarşılamaq üçün
function orderToJsonSafe(obj) {
  return JSON.parse(JSON.stringify(obj, (k, v) => {
    if (v && typeof v === "object") {
      if (ethers.BigNumber.isBigNumber(v)) return v.toString();
      if (v._hex) return ethers.BigNumber.from(v._hex).toString();
    }
    return v;
  }));
}

// ==========================================
// CÜZDAN QOŞULMASI
// ==========================================

async function connectWallet() {
  try {
    if (!window.ethereum) return alert("Metamask tapılmadı!");
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    
    await provider.send("eth_requestAccounts", []);
    const network = await provider.getNetwork();

    if (network.chainId !== APECHAIN_ID) {
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: APECHAIN_ID_HEX,
            chainName: "ApeChain Mainnet",
            nativeCurrency: { name: "APE", symbol: "APE", decimals: 18 },
            rpcUrls: [import.meta.env.VITE_APECHAIN_RPC || "https://rpc.apechain.com"],
            blockExplorerUrls: ["https://apescan.io"],
          }],
        });
        provider = new ethers.providers.Web3Provider(window.ethereum, "any");
      } catch (e) {
        return alert("ApeChain şəbəkəsinə keçilmədi.");
      }
    }

    signer = provider.getSigner();
    userAddress = (await signer.getAddress()).toLowerCase();

    // Seaport Init
    seaport = new Seaport(signer, { overrides: { contractAddress: SEAPORT_CONTRACT_ADDRESS } });
    
    connectBtn.style.display = "none";
    disconnectBtn.style.display = "inline-block";
    addrSpan.textContent = `Wallet: ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
    notify("Cüzdan qoşuldu!");
    
    await loadNFTs();
  } catch (err) {
    console.error(err);
    alert("Connect xətası: " + err.message);
  }
}

disconnectBtn.onclick = () => {
  provider = signer = seaport = userAddress = null;
  connectBtn.style.display = "inline-block";
  disconnectBtn.style.display = "none";
  addrSpan.textContent = "";
  marketplaceDiv.innerHTML = "";
  notify("Çıxış edildi");
};

connectBtn.onclick = connectWallet;

// ==========================================
// NFT YÜKLƏMƏ
// ==========================================

let loadingNFTs = false;
let loadedCount = 0;
let allNFTs = [];

async function loadNFTs() {
  if (loadingNFTs) return;
  loadingNFTs = true;
  try {
    if (allNFTs.length === 0) {
      const res = await fetch(`${BACKEND_URL}/api/nfts`);
      const data = await res.json();
      allNFTs = data.nfts || [];
    }

    if (loadedCount >= allNFTs.length) {
      if (loadedCount === 0) marketplaceDiv.innerHTML = "<p style='color:white;'>Hələ NFT yoxdur.</p>";
      return;
    }

    const batch = allNFTs.slice(loadedCount, loadedCount + 12);
    loadedCount += batch.length;

    for (const nft of batch) {
      const tokenid = nft.tokenid;
      const name = nft.name || `NFT #${tokenid}`;
      const image = resolveIPFS(nft.image);
      
      let displayPrice = "-";
      let priceVal = 0;
      if (nft.price && parseFloat(nft.price) > 0) {
        priceVal = parseFloat(nft.price);
        displayPrice = priceVal + " APE";
      }

      const card = document.createElement("div");
      card.className = "nft-card";
      card.innerHTML = `
        <img src="${image}" onerror="this.src='https://via.placeholder.com/300?text=Error'">
        <h4>${name}</h4>
        <p class="price">Qiymət: ${displayPrice}</p>
        <div class="nft-actions">
            ${priceVal > 0 ? `<button class="wallet-btn buy-btn" style="width:100%">Buy</button>` : 
              `<input type="number" placeholder="Price" class="price-input">
               <button class="wallet-btn list-btn">List</button>`
            }
        </div>
      `;
      marketplaceDiv.appendChild(card);

      if (priceVal > 0) {
        card.querySelector(".buy-btn").onclick = async () => await buyNFT(nft);
      } else {
        card.querySelector(".list-btn").onclick = async () => {
          const inp = card.querySelector(".price-input").value;
          if(!inp) return notify("Qiymət daxil edin");
          await listNFT(tokenid, ethers.utils.parseEther(inp), card);
        };
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    loadingNFTs = false;
  }
}

window.addEventListener("scroll", () => {
  if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 200) loadNFTs();
});

// ==========================================
// BUY FUNCTION (DÜZƏLDİLMİŞ)
// ==========================================

async function buyNFT(nftRecord) {
  if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");
  
  try {
    const buyerAddress = await signer.getAddress();
    
    if (nftRecord.seller_address?.toLowerCase() === buyerAddress.toLowerCase()) {
        return alert("Öz NFT-nizi ala bilməzsiniz.");
    }

    notify("Order emal edilir...");

    // 1. Data Parsing
    let rawJson = nftRecord.seaport_order;
    if (typeof rawJson === "string") {
      try { rawJson = JSON.parse(rawJson); } catch (e) { return alert("Order data xətası"); }
    }

    // 2. Data Cleaning
    const cleanOrd = cleanOrder(rawJson);
    if (!cleanOrd) return alert("Order strukturu xətalıdır.");

    // 3. Approval Check
    const seller = cleanOrd.parameters.offerer;
    const nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, ["function isApprovedForAll(address,address) view returns(bool)"], provider);
    const approved = await nftContract.isApprovedForAll(seller, SEAPORT_CONTRACT_ADDRESS);
    if (!approved) return alert("Satıcı icazəni ləğv edib.");

    // 4. Seaport Fulfill
    notify("Tranzaksiya hazırlanır...");
    const { actions } = await seaport.fulfillOrder({ order: cleanOrd, accountAddress: buyerAddress });
    const txRequest = await actions[0].transactionMethods.buildTransaction();

    // 5. Value Fix (Native Token)
    let finalValue = txRequest.value ? ethers.BigNumber.from(txRequest.value) : ethers.BigNumber.from(0);
    if (finalValue.eq(0)) {
       // Consideration-da Native Token (ItemType 0) varsa, value-nu ona bərabər et
       cleanOrd.parameters.consideration.forEach(c => {
         if (Number(c.itemType) === 0) finalValue = finalValue.add(ethers.BigNumber.from(c.endAmount));
       });
       txRequest.value = finalValue;
    }

    notify("Zəhmət olmasa təsdiqləyin...");

    // 6. Gas Limit Buffer
    let gasLimit = ethers.BigNumber.from("500000");
    try {
        const est = await signer.estimateGas({...txRequest, value: finalValue});
        gasLimit = est.mul(120).div(100); 
    } catch(e) { console.warn("Gas estimate fail, using default"); }

    const tx = await signer.sendTransaction({
      to: txRequest.to,
      data: txRequest.data,
      value: finalValue,
      gasLimit
    });

    notify("Gözləyin... ⏳");
    await tx.wait();
    notify("Uğurlu əməliyyat! 🎉");

    // 7. Backend Update
    await fetch(`${BACKEND_URL}/api/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenid: nftRecord.tokenid,
        order_hash: nftRecord.order_hash,
        buyer_address: buyerAddress
      }),
    });

    setTimeout(() => location.reload(), 2000);

  } catch (err) {
    console.error(err);
    alert("Buy Xətası: " + (err.message || err));
  }
}

// ==========================================
// LIST FUNCTION
// ==========================================

async function listNFT(tokenid, priceWei, card) {
  if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");

  try {
    const seller = await signer.getAddress();
    const tokenStr = tokenid.toString();

    // Approval
    const nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, 
      ["function isApprovedForAll(address,address) view returns(bool)", "function setApprovalForAll(address,bool)"], signer);
    
    if (!(await nftContract.isApprovedForAll(seller, SEAPORT_CONTRACT_ADDRESS))) {
       notify("İcazə verilir...");
       const tx = await nftContract.setApprovalForAll(SEAPORT_CONTRACT_ADDRESS, true);
       await tx.wait();
    }

    notify("İmza tələb olunur...");

    const orderInput = {
      offer: [{ itemType: 2, token: NFT_CONTRACT_ADDRESS, identifier: tokenStr }],
      consideration: [{ itemType: 0, token: ZERO_ADDRESS, identifier: "0", amount: priceWei.toString(), recipient: seller }],
      startTime: (Math.floor(Date.now()/1000)-100).toString(),
      endTime: (Math.floor(Date.now()/1000)+2592000).toString(), // 30 gün
    };

    const { executeAllActions } = await seaport.createOrder(orderInput, seller);
    const signedOrder = await executeAllActions();
    
    const plainOrder = orderToJsonSafe(signedOrder);
    const orderHash = seaport.getOrderHash(signedOrder.parameters);

    await fetch(`${BACKEND_URL}/api/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenid: tokenStr,
        price: ethers.utils.formatEther(priceWei),
        seller_address: seller,
        seaport_order: plainOrder,
        order_hash: orderHash,
        status: "active"
      }),
    });

    notify("Satışa qoyuldu! ✅");
    setTimeout(() => location.reload(), 1500);

  } catch (err) {
    console.error(err);
    alert("List Xətası: " + err.message);
  }
}

window.loadNFTs = loadNFTs;
