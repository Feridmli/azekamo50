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

// Order strukturunu təmizləyən və yoxlayan funksiya
function cleanOrder(orderData) {
  try {
    const order = orderData.order || orderData;
    const { parameters, signature } = order;
    if (!parameters) return null;

    // Safe toString helper
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

// JSON çevirmə zamanı BigNumber problemlərini həll edir
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
    
    // Provayderi yaradın
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    
    // Cüzdan qoşulması sorğusu
    await provider.send("eth_requestAccounts", []);
    const network = await provider.getNetwork();

    // Şəbəkə yoxlanışı (ApeChain)
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
        // Şəbəkə dəyişdikdən sonra provayderi yeniləyin
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
    
    // Hesab dəyişəndə səhifəni yenilə
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
// NFT YÜKLƏMƏ (SAHİBLİK YOXLANIŞI İLƏ)
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

    marketplaceDiv.innerHTML = ""; // Loading yazısını sil

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

      // 1. Qiyməti yoxla
      if (nft.price && parseFloat(nft.price) > 0) {
        priceVal = parseFloat(nft.price);
        displayPrice = `Qiymət: ${priceVal} APE`;
        isListed = true;
      }

      // 2. Həqiqi sahibi yoxla
      let realOwner = null;
      if (nftContractRead) {
          try {
             realOwner = await nftContractRead.ownerOf(tokenid);
          } catch(e) { 
             console.warn(`Token ${tokenid} owner check failed`); 
          }
      }

      // 3. Statusları müəyyən et
      const isMine = (userAddress && realOwner && userAddress.toLowerCase() === realOwner.toLowerCase());
      const isSeller = (userAddress && nft.seller_address && userAddress.toLowerCase() === nft.seller_address.toLowerCase());

      // HTML Render
      const card = document.createElement("div");
      card.className = "nft-card";
      
      let actionsHTML = "";

      if (isListed) {
          if (isSeller) {
              actionsHTML = `
                <input type="number" placeholder="New" class="price-input" step="0.001">
                <button class="wallet-btn update-btn" style="flex-grow:1;">Update</button>
              `;
          } else {
              actionsHTML = `<button class="wallet-btn buy-btn" style="width:100%">Buy</button>`;
          }
      } else {
          if (isMine) {
              displayPrice = "Satışda deyil";
              actionsHTML = `
                 <input type="number" placeholder="Price" class="price-input" step="0.001">
                 <button class="wallet-btn list-btn" style="flex-grow:1;">List</button>
              `;
          } else {
              displayPrice = ""; 
              actionsHTML = ""; 
          }
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

      // Event Listeners - Düymələrə funksiya qoşmaq
      if (actionsHTML !== "") {
          if (isListed) {
              if (isSeller) {
                 const btn = card.querySelector(".update-btn");
                 if(btn) btn.onclick = async () => {
                     const inp = card.querySelector(".price-input").value;
                     if(!inp) return notify("Yeni qiymət daxil edin");
                     await listNFT(tokenid, ethers.utils.parseEther(inp), "Qiymət yeniləndi");
                 };
              } else {
                 const btn = card.querySelector(".buy-btn");
                 // Burada birbaşa NFT obyektini göndəririk
                 if(btn) btn.onclick = async () => await buyNFT(nft);
              }
          } else if (isMine) {
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
// BUY FUNCTION (DÜZƏLDİLMİŞ VƏ TƏHLÜKƏSİZ)
// ==========================================

async function buyNFT(nftRecord) {
  if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");
  
  try {
    const buyerAddress = await signer.getAddress();
    
    // Satıcı yoxlanışı
    if (nftRecord.seller_address?.toLowerCase() === buyerAddress.toLowerCase()) {
        return alert("Öz NFT-nizi ala bilməzsiniz.");
    }

    notify("Order emal edilir...");

    // Order datasının mövcudluğunu yoxla
    let rawJson = nftRecord.seaport_order;
    if (!rawJson) return alert("Bu NFT üçün order məlumatı tapılmadı.");

    if (typeof rawJson === "string") {
      try { rawJson = JSON.parse(rawJson); } catch (e) { return alert("Order data xətası"); }
    }

    const cleanOrd = cleanOrder(rawJson);
    if (!cleanOrd) return alert("Order strukturu xətalıdır.");

    const seller = cleanOrd.parameters.offerer;
    
    // Satıcının icazəsini yoxla
    const nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, ["function isApprovedForAll(address,address) view returns(bool)"], provider);
    const approved = await nftContract.isApprovedForAll(seller, SEAPORT_CONTRACT_ADDRESS);
    if (!approved) return alert("Satıcı icazəni ləğv edib, alış mümkün deyil.");

    notify("Tranzaksiya hazırlanır...");
    
    // Seaport fulfillOrder
    const { actions } = await seaport.fulfillOrder({ order: cleanOrd, accountAddress: buyerAddress });
    const txRequest = await actions[0].transactionMethods.buildTransaction();

    // ============================================
    // BIGNUMBER XƏTASININ HƏLL EDİLDİYİ HİSSƏ
    // ============================================
    
    // Default olaraq 0 təyin et
    let finalValue = ethers.BigNumber.from(0);

    // Əgər Seaport birbaşa value veribsə, onu istifadə et (lakin undefined yoxla)
    if (txRequest.value) {
        finalValue = ethers.BigNumber.from(txRequest.value);
    } 
    // Əgər value 0-dırsa və ya verilməyibsə, manual olaraq consideration-dan hesabla
    if (finalValue.eq(0) && cleanOrd.parameters.consideration) {
       cleanOrd.parameters.consideration.forEach(c => {
         // itemType 0 = Native Currency (APE/ETH)
         if (Number(c.itemType) === 0) {
             const amount = c.endAmount ? c.endAmount.toString() : "0";
             finalValue = finalValue.add(ethers.BigNumber.from(amount));
         }
       });
    }

    console.log("Sending Transaction with Value:", finalValue.toString());

    notify("Zəhmət olmasa Metamask-da təsdiqləyin...");

    // Gas Limit üçün Fallback
    let gasLimit = ethers.BigNumber.from("500000"); // Standart limit
    try {
        // Parametrləri təmizləyib estimate edirik
        const estParams = {
            to: txRequest.to,
            data: txRequest.data,
            value: finalValue,
            from: buyerAddress
        };
        const est = await signer.estimateGas(estParams);
        gasLimit = est.mul(120).div(100); // +20% buffer
    } catch(e) { 
        console.warn("Gas estimate failed, using default 500k", e); 
    }

    // Tranzaksiyanı göndər
    const tx = await signer.sendTransaction({
      to: txRequest.to,
      data: txRequest.data,
      value: finalValue, // Artıq bu heç vaxt undefined ola bilməz
      gasLimit: gasLimit
    });

    notify("Gözləyin... ⏳");
    await tx.wait();
    notify("Uğurlu əməliyyat! 🎉");

    // Backend-ə məlumat ver
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
    console.error("Buy Critical Error:", err);
    // Xətanı istifadəçiyə oxunaqlı göstər
    let msg = err.message || JSON.stringify(err);
    if (msg.includes("insufficient funds")) msg = "Balansınız kifayət etmir.";
    if (msg.includes("user rejected")) msg = "İmtina edildi.";
    alert("Buy Xətası: " + msg);
  }
}

// ==========================================
// LIST & UPDATE FUNCTION
// ==========================================

async function listNFT(tokenid, priceWei, successMsg) {
  if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");

  try {
    const seller = await signer.getAddress();
    const tokenStr = tokenid.toString();

    // İcazə (Approval) yoxlanışı
    const nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, 
      ["function isApprovedForAll(address,address) view returns(bool)", "function setApprovalForAll(address,bool)"], signer);
    
    const isApproved = await nftContract.isApprovedForAll(seller, SEAPORT_CONTRACT_ADDRESS);
    
    if (!isApproved) {
       notify("İcazə verilir (Approve)...");
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

    // Backend-ə göndər
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
    alert("List/Update Xətası: " + err.message);
  }
}

// Qlobal funksiya kimi ixrac et (HTML-dən çağırıla bilsin)
window.loadNFTs = loadNFTs;
