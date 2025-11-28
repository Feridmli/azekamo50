import { Buffer } from "buffer";
window.Buffer = window.Buffer || Buffer;

import { ethers } from "ethers";
import { Seaport } from "@opensea/seaport-js";

// ==========================================
// KONFIQURASIYA
// ==========================================

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://azekamo50.onrender.com";
const NFT_CONTRACT_ADDRESS = import.meta.env.VITE_NFT_CONTRACT || "0x54a88333F6e7540eA982261301309048aC431eD5";
const SEAPORT_CONTRACT_ADDRESS = "0x0000000000000068F116a894984e2DB1123eB395";

const APECHAIN_ID = 33139;
const APECHAIN_ID_HEX = "0x8173";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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

function cleanOrder(orderData) {
  try {
    const order = orderData.order || orderData;
    const { parameters, signature } = order;
    if (!parameters) return null;

    const safeStr = (val) => (val !== undefined && val !== null) ? val.toString() : "0";

    return {
      parameters: {
        offerer: parameters.offerer,
        zone: parameters.zone,
        offer: parameters.offer.map(item => ({
          itemType: Number(item.itemType),
          token: item.token,
          identifierOrCriteria: safeStr(item.identifierOrCriteria),
          startAmount: safeStr(item.startAmount),
          endAmount: safeStr(item.endAmount)
        })),
        consideration: parameters.consideration.map(item => ({
          itemType: Number(item.itemType),
          token: item.token,
          identifierOrCriteria: safeStr(item.identifierOrCriteria),
          startAmount: safeStr(item.startAmount),
          endAmount: safeStr(item.endAmount),
          recipient: item.recipient
        })),
        orderType: Number(parameters.orderType),
        startTime: safeStr(parameters.startTime),
        endTime: safeStr(parameters.endTime),
        zoneHash: parameters.zoneHash,
        salt: safeStr(parameters.salt),
        conduitKey: parameters.conduitKey,
        totalOriginalConsiderationItems: Number(parameters.totalOriginalConsiderationItems)
      },
      signature: signature
    };
  } catch (e) {
    console.error("cleanOrder error:", e);
    return null;
  }
}

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

    seaport = new Seaport(signer, { overrides: { contractAddress: SEAPORT_CONTRACT_ADDRESS } });
    
    connectBtn.style.display = "none";
    disconnectBtn.style.display = "inline-block";
    addrSpan.textContent = `Wallet: ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
    notify("Cüzdan qoşuldu!");
    
    window.ethereum.on("accountsChanged", () => location.reload());

    await loadNFTs();
  } catch (err) {
    console.error("Connect Error:", err);
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
// NFT YÜKLƏMƏ (DÜZƏLDİLMİŞ LOGİKA)
// ==========================================

let loadingNFTs = false;
let allNFTs = [];

async function loadNFTs() {
  if (loadingNFTs) return;
  loadingNFTs = true;
  marketplaceDiv.innerHTML = "<p style='color:white; width:100%; text-align:center;'>NFT-lər yüklənir...</p>";
  
  try {
    const res = await fetch(`${BACKEND_URL}/api/nfts`);
    const data = await res.json();
    allNFTs = data.nfts || [];

    marketplaceDiv.innerHTML = "";

    if (allNFTs.length === 0) {
      marketplaceDiv.innerHTML = "<p style='color:white; width:100%; text-align:center;'>Hələ NFT yoxdur.</p>";
      return;
    }

    let nftContractRead = null;
    if (provider) {
       nftContractRead = new ethers.Contract(NFT_CONTRACT_ADDRESS, ["function ownerOf(uint256) view returns (address)"], provider);
    }

    for (const nft of allNFTs) {
      const tokenid = nft.tokenid;
      const name = nft.name || `NFT #${tokenid}`;
      const image = resolveIPFS(nft.image);
      
      let displayPrice = "";
      let priceVal = 0;
      let isListed = false;

      // 1. NFT satışdadırmı? (Qiymət varmı?)
      if (nft.price && parseFloat(nft.price) > 0) {
        priceVal = parseFloat(nft.price);
        displayPrice = `Qiymət: ${priceVal} APE`;
        isListed = true;
      }

      // 2. Blockchain sahibi
      let realOwner = null;
      if (nftContractRead) {
          try {
             realOwner = await nftContractRead.ownerOf(tokenid);
          } catch(e) { console.warn(`Check failed: ${tokenid}`); }
      }

      // 3. İstifadəçi statusları
      // isMine: Blockchain-də sahibi mənəm
      const isMine = (userAddress && realOwner && userAddress.toLowerCase() === realOwner.toLowerCase());
      // isSeller: Saytda bunu mən satışa qoymuşam (DB-də satıcı mənəm)
      const isSeller = (userAddress && nft.seller_address && userAddress.toLowerCase() === nft.seller_address.toLowerCase());

      const card = document.createElement("div");
      card.className = "nft-card";
      
      let actionsHTML = "";

      // --- LOGİKA BURADA DƏYİŞDİRİLDİ ---
      
      if (isListed) {
          // Əgər satışdadırsa:
          if (isSeller) {
              // A) Satıcı MƏNƏM (Buy düyməsi olmasın, New List olsun)
              // Update button class-ını saxlayırıq ki, aşağıda event listener işləsin, amma adını "New List" qoyuruq
              actionsHTML = `
                <input type="number" placeholder="New Price" class="price-input" step="0.001">
                <button class="wallet-btn update-btn" style="flex-grow:1;">New List</button>
              `;
          } else {
              // B) Satıcı BAŞQASIDIR (Buy düyməsi olsun)
              actionsHTML = `<button class="wallet-btn buy-btn" style="width:100%">Buy</button>`;
          }
      } else {
          // Əgər satışda deyilsə:
          if (isMine) {
              // C) Sahibi MƏNƏM (List düyməsi olsun)
              displayPrice = "Satışda deyil";
              actionsHTML = `
                 <input type="number" placeholder="Price" class="price-input" step="0.001">
                 <button class="wallet-btn list-btn" style="flex-grow:1;">List</button>
              `;
          } 
          // D) Sahibi mən deyiləm və satışda deyil -> Boş qalsın
      }

      card.innerHTML = `
        <img src="${image}" onerror="this.src='https://via.placeholder.com/300?text=Error'">
        <h4>${name}</h4>
        ${displayPrice ? `<p class="price">${displayPrice}</p>` : `<p style="min-height:22px;"></p>`}
        <div class="nft-actions">
            ${actionsHTML}
        </div>
      `;
      marketplaceDiv.appendChild(card);

      // Event Listeners
      if (actionsHTML !== "") {
          if (isListed) {
              if (isSeller) {
                 // OWNER: Update Logic ("New List" düyməsi)
                 const btn = card.querySelector(".update-btn");
                 if(btn) btn.onclick = async () => {
                     const inp = card.querySelector(".price-input").value;
                     if(!inp) return notify("Yeni qiymət daxil edin");
                     // Update edəndə də listNFT çağırırıq, bu yeni order yaradır
                     await listNFT(tokenid, ethers.utils.parseEther(inp), "Qiymət yeniləndi");
                 };
              } else {
                 // BUYER: Buy Logic
                 const btn = card.querySelector(".buy-btn");
                 if(btn) btn.onclick = async () => await buyNFT(nft);
              }
          } else if (isMine) {
              // OWNER: First List Logic
              const btn = card.querySelector(".list-btn");
              if(btn) btn.onclick = async () => {
                 const inp = card.querySelector(".price-input").value;
                 if(!inp) return notify("Qiymət daxil edin");
                 await listNFT(tokenid, ethers.utils.parseEther(inp), "Satışa qoyuldu");
              };
          }
      }
    }
  } catch (err) {
    console.error(err);
    marketplaceDiv.innerHTML = "<p style='color:red;'>Məlumatları yükləmək olmadı.</p>";
  } finally {
    loadingNFTs = false;
  }
}

// ==========================================
// BUY FUNCTION
// ==========================================

async function buyNFT(nftRecord) {
  if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");
  
  try {
    const buyerAddress = await signer.getAddress();
    if (nftRecord.seller_address?.toLowerCase() === buyerAddress.toLowerCase()) {
        return alert("Öz NFT-nizi ala bilməzsiniz.");
    }

    notify("Order emal edilir...");

    let rawJson = nftRecord.seaport_order;
    if (!rawJson) return alert("Order yoxdur.");

    if (typeof rawJson === "string") {
      try { rawJson = JSON.parse(rawJson); } catch (e) { return alert("Order data xətası"); }
    }

    const cleanOrd = cleanOrder(rawJson);
    if (!cleanOrd) return alert("Order strukturu xətalıdır.");

    const seller = cleanOrd.parameters.offerer;
    const nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, ["function isApprovedForAll(address,address) view returns(bool)"], provider);
    const approved = await nftContract.isApprovedForAll(seller, SEAPORT_CONTRACT_ADDRESS);
    if (!approved) return alert("Satıcı icazəni ləğv edib.");

    notify("Tranzaksiya hazırlanır...");
    
    const { actions } = await seaport.fulfillOrder({ order: cleanOrd, accountAddress: buyerAddress });
    const txRequest = await actions[0].transactionMethods.buildTransaction();

    let finalValue = ethers.BigNumber.from(0);
    if (txRequest.value) {
        finalValue = ethers.BigNumber.from(txRequest.value);
    } 
    if (finalValue.eq(0) && cleanOrd.parameters.consideration) {
       cleanOrd.parameters.consideration.forEach(c => {
         if (Number(c.itemType) === 0) {
             const amount = c.endAmount ? c.endAmount.toString() : "0";
             finalValue = finalValue.add(ethers.BigNumber.from(amount));
         }
       });
    }

    notify("Təsdiqləyin...");

    let gasLimit = ethers.BigNumber.from("500000");
    try {
        const estParams = { to: txRequest.to, data: txRequest.data, value: finalValue, from: buyerAddress };
        const est = await signer.estimateGas(estParams);
        gasLimit = est.mul(120).div(100); 
    } catch(e) { console.warn("Gas estimate default"); }

    const tx = await signer.sendTransaction({
      to: txRequest.to,
      data: txRequest.data,
      value: finalValue,
      gasLimit
    });

    notify("Gözləyin... ⏳");
    await tx.wait();
    notify("Uğurlu əməliyyat! 🎉");

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
    alert("Buy Xətası: " + err.message);
  }
}

// ==========================================
// LIST & UPDATE (NEW LIST) FUNCTION
// ==========================================

async function listNFT(tokenid, priceWei, successMsg) {
  if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");

  try {
    const seller = await signer.getAddress();
    const tokenStr = tokenid.toString();

    const nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, 
      ["function isApprovedForAll(address,address) view returns(bool)", "function setApprovalForAll(address,bool)"], signer);
    
    const isApproved = await nftContract.isApprovedForAll(seller, SEAPORT_CONTRACT_ADDRESS);
    
    if (!isApproved) {
       notify("İcazə verilir...");
       const tx = await nftContract.setApprovalForAll(SEAPORT_CONTRACT_ADDRESS, true);
       await tx.wait();
    }

    notify("İmza tələb olunur...");

    const orderInput = {
      offer: [{ itemType: 2, token: NFT_CONTRACT_ADDRESS, identifier: tokenStr }],
      consideration: [{ itemType: 0, token: ZERO_ADDRESS, identifier: "0", amount: priceWei.toString(), recipient: seller }],
      startTime: (Math.floor(Date.now()/1000)).toString(),
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

    notify(`${successMsg}! ✅`);
    setTimeout(() => location.reload(), 1500);

  } catch (err) {
    console.error(err);
    alert("List Xətası: " + err.message);
  }
}

window.loadNFTs = loadNFTs;
