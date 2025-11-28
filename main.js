import { Buffer } from "buffer";
window.Buffer = window.Buffer || Buffer;

import { ethers } from "ethers";
import { Seaport } from "@opensea/seaport-js";

// ==========================================
// KONFIQURASIYA VƏ SABİTLƏR
// ==========================================

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  window?.__BACKEND_URL__ ||
  "https://azekamo20.onrender.com";

const NFT_CONTRACT_ADDRESS =
  import.meta.env.VITE_NFT_CONTRACT ||
  window?.__NFT_CONTRACT__ ||
  "0x54a88333F6e7540eA982261301309048aC431eD5";

// Seaport 1.5 Canonical Address
const SEAPORT_CONTRACT_ADDRESS = "0x0000000000000068F116a894984e2DB1123eB395";

const APECHAIN_ID = 33139;
const APECHAIN_ID_HEX = "0x8173";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

let provider = null;
let signer = null;
let seaport = null;
let userAddress = null;

const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const addrSpan = document.getElementById("addr");
const marketplaceDiv = document.getElementById("marketplace");
const noticeDiv = document.getElementById("notice");

// ==========================================
// KÖMƏKÇİ FUNKSİYALAR
// ==========================================

function notify(msg, timeout = 4000) {
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

// Orderi "təmizləyən" və tipləri düzəldən funksiya
function cleanOrder(orderData) {
  let order = orderData.order || orderData;
  if (!order.parameters) return null;

  return {
    parameters: {
      offerer: order.parameters.offerer,
      zone: order.parameters.zone || ZERO_ADDRESS,
      offer: order.parameters.offer.map(item => ({
        itemType: Number(item.itemType),
        token: item.token,
        identifierOrCriteria: item.identifierOrCriteria.toString(),
        startAmount: item.startAmount.toString(),
        endAmount: item.endAmount.toString()
      })),
      consideration: order.parameters.consideration.map(item => ({
        itemType: Number(item.itemType),
        token: item.token,
        identifierOrCriteria: item.identifierOrCriteria.toString(),
        startAmount: item.startAmount.toString(),
        endAmount: item.endAmount.toString(),
        recipient: item.recipient
      })),
      orderType: Number(order.parameters.orderType),
      startTime: order.parameters.startTime.toString(),
      endTime: order.parameters.endTime.toString(),
      zoneHash: order.parameters.zoneHash || ZERO_BYTES32,
      salt: order.parameters.salt.toString(),
      conduitKey: order.parameters.conduitKey || ZERO_BYTES32,
      totalOriginalConsiderationItems: Number(order.parameters.totalOriginalConsiderationItems || order.parameters.consideration.length),
    },
    signature: order.signature
  };
}

function orderToJsonSafe(obj) {
  return JSON.parse(JSON.stringify(obj, (k, v) => {
    if (v && typeof v === "object") {
      if (ethers.BigNumber.isBigNumber(v)) return v.toString();
      if (v._hex) return ethers.BigNumber.from(v._hex).toString();
    }
    if (typeof v === "bigint") return v.toString();
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

    // Seaport Versiya 1.5-i məcbur edirik
    seaport = new Seaport(signer, { 
        overrides: { contractAddress: SEAPORT_CONTRACT_ADDRESS },
        seaportVersion: "1.5"
    });
    
    connectBtn.style.display = "none";
    disconnectBtn.style.display = "inline-block";
    addrSpan.textContent = `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
    notify("Cüzdan qoşuldu!");
    await loadNFTs();
  } catch (err) {
    alert("Wallet connect xətası: " + err.message);
  }
}

disconnectBtn.onclick = () => {
  provider = signer = seaport = userAddress = null;
  connectBtn.style.display = "inline-block";
  disconnectBtn.style.display = "none";
  addrSpan.textContent = "";
  marketplaceDiv.innerHTML = "";
  notify("Cüzdan ayırıldı");
};
connectBtn.onclick = connectWallet;

// ==========================================
// NFT YÜKLƏMƏ
// ==========================================

let loadingNFTs = false;
let loadedCount = 0;
const BATCH_SIZE = 12;
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
      if (loadedCount === 0) marketplaceDiv.innerHTML = "<p style='color:white; text-align:center;'>NFT yoxdur.</p>";
      return;
    }

    const batch = allNFTs.slice(loadedCount, loadedCount + BATCH_SIZE);
    loadedCount += batch.length;

    for (const nft of batch) {
      const tokenid = nft.tokenid;
      const name = nft.name || `NFT #${tokenid}`;
      const image = resolveIPFS(nft.image);
      
      let displayPrice = "-";
      if (nft.price && parseFloat(nft.price) > 0) displayPrice = parseFloat(nft.price) + " APE";

      const card = document.createElement("div");
      card.className = "nft-card";
      card.innerHTML = `
        <img src="${image}" alt="NFT" onerror="this.src='https://via.placeholder.com/300?text=Error'">
        <h4>${name}</h4>
        <p class="price">Qiymət: ${displayPrice}</p>
        <div class="nft-actions">
            <input type="number" min="0" step="0.01" class="price-input" placeholder="APE">
            <button class="wallet-btn buy-btn">Buy</button>
            <button class="wallet-btn list-btn" data-token="${tokenid}">List</button>
        </div>
      `;
      marketplaceDiv.appendChild(card);

      card.querySelector(".buy-btn").onclick = async () => await buyNFT(nft);
      card.querySelector(".list-btn").onclick = async (e) => {
        const rawTokenId = e.currentTarget.getAttribute("data-token");
        const priceInput = card.querySelector(".price-input");
        if (!priceInput.value) return notify("Qiymət yazın!");
        try {
          const priceWei = ethers.utils.parseEther(priceInput.value);
          await listNFT(rawTokenId, priceWei, card);
        } catch { notify("Yanlış qiymət!"); }
      };
    }
  } catch (err) { console.error(err); } 
  finally { loadingNFTs = false; }
}

window.addEventListener("scroll", () => {
  if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 300) loadNFTs();
});

// ==========================================
// BUY FUNCTION (GÜCLƏNDİRİLMİŞ)
// ==========================================

async function buyNFT(nftRecord) {
  if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");
  
  try {
    const buyerAddress = await signer.getAddress();
    
    if (nftRecord.seller_address && nftRecord.seller_address.toLowerCase() === buyerAddress.toLowerCase()) {
        return alert("Öz NFT-nizi ala bilməzsiniz!");
    }
    
    notify("Order yoxlanılır...");

    // 1. Orderin Oxunması və Təmizlənməsi
    let rawJson = nftRecord.seaport_order ?? nftRecord.seaportOrderJSON;
    if (typeof rawJson === "string") {
      try { rawJson = JSON.parse(rawJson); } catch (e) { return alert("JSON parse xətası"); }
    }

    const cleanOrd = cleanOrder(rawJson);
    if (!cleanOrd) return alert("Order formatı xətalıdır.");

    // 2. Hash Yoxlanışı (Verilənlər bazası bütövlüyü)
    try {
        // Seaport-js vasitəsilə hash hesablayırıq
        const computedHash = seaport.getOrderHash(cleanOrd.parameters);
        if (nftRecord.order_hash && computedHash !== nftRecord.order_hash) {
            console.error("Hash Mismatch!", "DB:", nftRecord.order_hash, "Computed:", computedHash);
            return alert("XƏTA: Bu listing 'zədələnib' (imza uyğunsuzluğu). Zəhmət olmasa satıcı listingi yeniləsin.");
        }
    } catch (hErr) {
        console.warn("Hash check warning:", hErr);
    }

    // 3. Qiymət Hesablanması (APE)
    let valueToSend = ethers.BigNumber.from(0);
    cleanOrd.parameters.consideration.forEach(item => {
        if (Number(item.itemType) === 0) { // Native Token
            valueToSend = valueToSend.add(ethers.BigNumber.from(item.endAmount));
        }
    });

    console.log("Ödəniləcək APE (Wei):", valueToSend.toString());

    // 4. Balans Yoxlanışı
    const balance = await provider.getBalance(buyerAddress);
    if (balance.lt(valueToSend)) {
        return alert(`Balansınız yetərsizdir! Sizdə: ${ethers.utils.formatEther(balance)} APE, Lazımdır: ${ethers.utils.formatEther(valueToSend)} APE`);
    }

    // 5. Tranzaksiya Hazırlanması
    notify("Tranzaksiya imzalanır...");
    
    const { actions } = await seaport.fulfillOrder({ 
      order: cleanOrd, 
      accountAddress: buyerAddress,
    });

    if (!actions || actions.length === 0) throw new Error("Seaport actions boşdur.");

    const action = actions[0];
    const txRequest = await action.transactionMethods.buildTransaction();

    // Value və Gas məcbur edilir
    txRequest.value = valueToSend; 
    
    // Gas Hesablanması (Təhlükəsizlik üçün)
    let estimatedGas = ethers.BigNumber.from("2500000"); // Default High
    try {
        const gasEst = await signer.estimateGas({
            to: txRequest.to,
            data: txRequest.data,
            value: txRequest.value
        });
        estimatedGas = gasEst.mul(120).div(100); // +20% buffer
        console.log("Gas Estimate:", estimatedGas.toString());
    } catch (gasErr) {
        console.warn("Gas estimate failed (Simulyasiya xətası):", gasErr?.error?.message || gasErr.message);
        // İstifadəçidən soruşuruq
        const proceed = confirm("Xəbərdarlıq: Simulyasiya xəta verdi. Bu, adətən balansın çatışmazlığı və ya orderin artıq ləğv edilməsi səbəbindən olur. Yenə də tranzaksiyanı göndərmək istəyirsiniz?");
        if (!proceed) return notify("Ləğv edildi.");
    }

    notify("Cüzdanda təsdiqləyin...");

    const tx = await signer.sendTransaction({
      to: txRequest.to,
      data: txRequest.data,
      value: txRequest.value,
      gasLimit: estimatedGas
    });

    notify("Gözləyin... ⏳");
    await tx.wait();
    
    notify("Uğurlu əməliyyat! 🎉");
    
    // Backend Update
    await fetch(`${BACKEND_URL}/api/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenid: nftRecord.tokenid,
        order_hash: nftRecord.order_hash,
        buyer_address: buyerAddress,
        price: parseFloat(ethers.utils.formatEther(valueToSend)),
      }),
    });

    setTimeout(() => { 
        marketplaceDiv.innerHTML = ""; loadedCount = 0; allNFTs = []; loadNFTs(); 
    }, 2000);

  } catch (err) { 
    console.error("Buy Error:", err);
    // Xəta detallarını çıxarmaq
    let msg = err.message || "Bilinməyən xəta";
    if (err.data?.message) msg = err.data.message;
    if (msg.includes("insufficient funds")) msg = "Balansınız yetərsizdir (Gas + Price).";
    if (msg.includes("user rejected")) msg = "İmtina etdiniz.";
    
    alert("Buy Xətası: " + msg); 
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

    // Sahiblik yoxlanışı
    const nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, ["function ownerOf(uint256) view returns (address)"], signer);
    try {
        const owner = await nftContract.ownerOf(tokenStr);
        if (owner.toLowerCase() !== seller.toLowerCase()) return alert("Siz sahib deyilsiniz!");
    } catch (e) { return alert("NFT məlumatı oxuna bilmədi."); }

    // Approval
    const nftRw = new ethers.Contract(NFT_CONTRACT_ADDRESS, ["function isApprovedForAll(address,address) view returns(bool)", "function setApprovalForAll(address,bool)"], signer);
    const approved = await nftRw.isApprovedForAll(seller, SEAPORT_CONTRACT_ADDRESS);
    if (!approved) {
      notify("Approve edilir...");
      const tx = await nftRw.setApprovalForAll(SEAPORT_CONTRACT_ADDRESS, true);
      await tx.wait();
    }

    notify("İmza yaradılır...");

    // Orderin yaradılması
    const orderInput = {
      offer: [{ itemType: 2, token: NFT_CONTRACT_ADDRESS, identifier: tokenStr }],
      consideration: [{ itemType: 0, token: ZERO_ADDRESS, identifier: "0", amount: priceWei.toString(), recipient: seller }],
      startTime: (Math.floor(Date.now() / 1000) - 300).toString(), // 5 dəq geri
      endTime: (Math.floor(Date.now() / 1000) + 30 * 86400).toString(), // 30 gün
      conduitKey: ZERO_BYTES32,
      zone: ZERO_ADDRESS,
    };

    const { executeAllActions } = await seaport.createOrder(orderInput, seller);
    const signedOrder = await executeAllActions();
    
    // Hash və JSON
    const orderHash = seaport.getOrderHash(signedOrder.parameters);
    const plainOrder = orderToJsonSafe(signedOrder);

    await fetch(`${BACKEND_URL}/api/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenid: tokenStr,
        price: ethers.utils.formatEther(priceWei),
        seller_address: seller.toLowerCase(),
        seaport_order: plainOrder,
        order_hash: orderHash,
        image: card.querySelector("img").src
      }),
    });

    notify("Satışa qoyuldu! ✅");
    setTimeout(() => { marketplaceDiv.innerHTML = ""; loadedCount = 0; allNFTs = []; loadNFTs(); }, 1500);

  } catch (err) { 
    console.error("List Error:", err); 
    alert("Listing Xətası: " + err.message); 
  }
}

window.connectWallet = connectWallet;
window.buyNFT = buyNFT;
window.listNFT = listNFT;
window.loadNFTs = loadNFTs;
