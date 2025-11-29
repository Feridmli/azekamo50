import { Buffer } from "buffer";
window.Buffer = window.Buffer || Buffer;

import { ethers } from "ethers";
import { Seaport } from "@opensea/seaport-js";

// ==========================================
// KONFIQURASIYA
// ==========================================

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://azekamo60.onrender.com";
const NFT_CONTRACT_ADDRESS = import.meta.env.VITE_NFT_CONTRACT || "0x54a88333F6e7540eA982261301309048aC431eD5";
const SEAPORT_CONTRACT_ADDRESS = "0x0000000000000068F116a894984e2DB1123eB395";

const APECHAIN_ID = 33139;
const APECHAIN_ID_HEX = "0x8173";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

let provider = null;
let signer = null;
let seaport = null;
let userAddress = null;

let selectedTokens = new Set();

const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const addrSpan = document.getElementById("addr");
const marketplaceDiv = document.getElementById("marketplace");
const noticeDiv = document.getElementById("notice");
const bulkBar = document.getElementById("bulkBar");
const bulkCount = document.getElementById("bulkCount");
const bulkPriceInp = document.getElementById("bulkPrice");
const bulkListBtn = document.getElementById("bulkListBtn");

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
  if (!url) return "https://i.postimg.cc/Hng3NRg7/Steptract-Logo.png";
  const GATEWAY = "https://cloudflare-ipfs.com/ipfs/";
  let originalUrl = url;
  if (url.startsWith("ipfs://")) {
    originalUrl = url.replace("ipfs://", GATEWAY);
  } else if (url.startsWith("Qm") && url.length >= 46) {
    originalUrl = `${GATEWAY}${url}`;
  }
  return `https://wsrv.nl/?url=${encodeURIComponent(originalUrl)}&w=500&q=75&output=webp&il`;
}

// ---------------------------------------------
// SEAPORT v1.6 ORDER TƏMİZLƏMƏ (FIXED - SIGNATURE)
// ---------------------------------------------
function cleanOrder(orderData) {
  try {
    const order = orderData.order || orderData;
    const { parameters, signature } = order;

    if (!parameters) {
        console.error("Order parameters not found:", orderData);
        return null;
    }

    // Dəyərləri String (uint256) formatına salan köməkçi
    const toStr = (val) => {
        if (val === undefined || val === null) return "0";
        return val.toString();
    };

    return {
      parameters: {
        offerer: parameters.offerer,
        zone: parameters.zone,
        // Offer item-ləri təmizlə
        offer: parameters.offer.map(item => ({
          itemType: Number(item.itemType), // Mütləq Number
          token: item.token,
          identifierOrCriteria: toStr(item.identifierOrCriteria || item.identifier),
          startAmount: toStr(item.startAmount),
          endAmount: toStr(item.endAmount)
        })),
        // Consideration item-ləri təmizlə
        consideration: parameters.consideration.map(item => ({
          itemType: Number(item.itemType), // Mütləq Number
          token: item.token,
          identifierOrCriteria: toStr(item.identifierOrCriteria || item.identifier),
          startAmount: toStr(item.startAmount),
          endAmount: toStr(item.endAmount),
          recipient: item.recipient
        })),
        orderType: Number(parameters.orderType), // 0,1,2...
        startTime: toStr(parameters.startTime),
        endTime: toStr(parameters.endTime),
        zoneHash: parameters.zoneHash,
        salt: toStr(parameters.salt),
        conduitKey: parameters.conduitKey,
        counter: toStr(parameters.counter),
        // Bu sahə imza üçün kritikdir:
        totalOriginalConsiderationItems: Number(
            parameters.totalOriginalConsiderationItems !== undefined 
            ? parameters.totalOriginalConsiderationItems 
            : parameters.consideration.length
        )
      },
      signature: signature
    };
  } catch (e) { 
      console.error("CleanOrder Error:", e);
      return null; 
  }
}

// BigNumber xətalarının qarşısını alır
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
      } catch (e) { return alert("ApeChain şəbəkəsinə keçilmədi."); }
    }

    signer = provider.getSigner();
    userAddress = (await signer.getAddress()).toLowerCase();
    
    seaport = new Seaport(signer, { 
        overrides: { contractAddress: SEAPORT_CONTRACT_ADDRESS } 
    });
    
    connectBtn.style.display = "none";
    disconnectBtn.style.display = "inline-block";
    addrSpan.textContent = `Wallet: ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
    notify("Cüzdan qoşuldu!");
    window.ethereum.on("accountsChanged", () => location.reload());

    await loadNFTs();
  } catch (err) { alert("Connect xətası: " + err.message); }
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
let allNFTs = [];

async function loadNFTs() {
  if (loadingNFTs) return;
  loadingNFTs = true;
  marketplaceDiv.innerHTML = "<p style='color:black; width:100%; text-align:center;'>NFT-lər yüklənir...</p>";
  
  selectedTokens.clear();
  updateBulkUI();

  try {
    const res = await fetch(`${BACKEND_URL}/api/nfts`);
    const data = await res.json();
    allNFTs = data.nfts || [];
    marketplaceDiv.innerHTML = "";

    if (allNFTs.length === 0) {
      marketplaceDiv.innerHTML = "<p style='color:black; width:100%; text-align:center;'>Hələ NFT yoxdur.</p>";
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

      if (nft.price && parseFloat(nft.price) > 0) {
        priceVal = parseFloat(nft.price);
        displayPrice = `${priceVal} APE`;
        isListed = true;
      }

      let realOwner = null;
      if (nftContractRead) {
          try { realOwner = await nftContractRead.ownerOf(tokenid); } catch(e) {}
      }

      const isMine = (userAddress && realOwner && userAddress.toLowerCase() === realOwner.toLowerCase());
      const isSeller = (userAddress && nft.seller_address && userAddress.toLowerCase() === nft.seller_address.toLowerCase());
      const canManage = isMine || isSeller;

      const card = document.createElement("div");
      card.className = "nft-card";
      
      let checkboxHTML = "";
      if (canManage) {
          checkboxHTML = `<input type="checkbox" class="select-box" data-id="${tokenid}">`;
      }

      let actionsHTML = "";
      if (isListed) {
          if (canManage) {
              actionsHTML = `
                <input type="number" placeholder="New Price" class="mini-input price-input" step="0.001">
                <button class="action-btn btn-list update-btn">Update</button>
              `;
          } else {
              actionsHTML = `<button class="action-btn btn-buy buy-btn">Buy</button>`;
          }
      } else {
          if (canManage) {
              displayPrice = ""; 
              actionsHTML = `
                 <input type="number" placeholder="Price" class="mini-input price-input" step="0.001">
                 <button class="action-btn btn-list list-btn">List</button>
              `;
          }
      }

      card.innerHTML = `
        ${checkboxHTML}
        <div class="card-image-wrapper">
            <img src="${image}" loading="lazy" decoding="async" onerror="this.src='https://i.postimg.cc/Hng3NRg7/Steptract-Logo.png'">
        </div>
        <div class="card-content">
            <div class="card-title">${name}</div>
            <div class="card-details">
                 ${displayPrice ? `<div class="price-val">${displayPrice}</div>` : `<div style="height:24px"></div>`}
            </div>
            <div class="card-actions">
                ${actionsHTML}
            </div>
        </div>
      `;
      marketplaceDiv.appendChild(card);

      const chk = card.querySelector(".select-box");
      if (chk) {
          chk.onchange = (e) => {
              if (e.target.checked) selectedTokens.add(tokenid.toString());
              else selectedTokens.delete(tokenid.toString());
              updateBulkUI();
          };
      }

      if (actionsHTML !== "") {
          if (isListed) {
              if (canManage) {
                 const btn = card.querySelector(".update-btn");
                 if(btn) btn.onclick = async () => {
                     const inp = card.querySelector(".price-input").value;
                     if(!inp) return notify("Yeni qiymət yazın");
                     await listNFT(tokenid, ethers.utils.parseEther(inp));
                 };
              } else {
                 const btn = card.querySelector(".buy-btn");
                 if(btn) btn.onclick = async () => await buyNFT(nft);
              }
          } else if (canManage) {
              const btn = card.querySelector(".list-btn");
              if(btn) btn.onclick = async () => {
                 const inp = card.querySelector(".price-input").value;
                 if(!inp) return notify("Qiymət yazın");
                 await listNFT(tokenid, ethers.utils.parseEther(inp));
              };
          }
      }
    }
  } catch (err) {
    console.error(err);
    marketplaceDiv.innerHTML = "<p style='color:red; text-align:center;'>Yüklənmə xətası.</p>";
  } finally {
    loadingNFTs = false;
  }
}

// ==========================================
// TOPLU (BULK) UI LOGIKASI
// ==========================================

function updateBulkUI() {
    if (selectedTokens.size > 0) {
        bulkBar.classList.add("active");
        bulkCount.textContent = `${selectedTokens.size} NFT seçildi`;
    } else {
        bulkBar.classList.remove("active");
    }
}

window.cancelBulk = () => {
    selectedTokens.clear();
    document.querySelectorAll(".select-box").forEach(b => b.checked = false);
    updateBulkUI();
};

if(bulkListBtn) {
    bulkListBtn.onclick = async () => {
        const priceVal = bulkPriceInp.value;
        if (!priceVal || parseFloat(priceVal) <= 0) return alert("Toplu satış üçün düzgün qiymət yazın.");
        
        const priceWei = ethers.utils.parseEther(priceVal);
        const tokensArray = Array.from(selectedTokens);
        
        await bulkListNFTs(tokensArray, priceWei);
    };
}

// ==========================================
// TOPLU LISTƏLƏMƏ
// ==========================================

async function bulkListNFTs(tokenIds, priceWei) {
    if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");
    
    const seller = await signer.getAddress();

    // 1. APPROVAL (ICAZƏ) YOXLANIR
    try {
        const nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, 
            ["function isApprovedForAll(address,address) view returns(bool)", "function setApprovalForAll(address,bool)"], signer);
        
        const isApproved = await nftContract.isApprovedForAll(seller, SEAPORT_CONTRACT_ADDRESS);
        if (!isApproved) {
            notify("Satış üçün kontrakt təsdiqi tələb olunur...");
            const tx = await nftContract.setApprovalForAll(SEAPORT_CONTRACT_ADDRESS, true);
            await tx.wait();
            notify("Təsdiqləndi!");
        }
    } catch (e) { return alert("Approve xətası: " + e.message); }

    notify(`${tokenIds.length} NFT orderi hazırlanır...`);

    try {
        const orderInputs = tokenIds.map(tokenStr => {
            return {
                offer: [{ 
                    itemType: 2,  // ERC721
                    token: NFT_CONTRACT_ADDRESS, 
                    identifier: tokenStr 
                }],
                consideration: [{ 
                    itemType: 0, // NATIVE APE
                    token: ZERO_ADDRESS, 
                    identifier: "0", 
                    amount: priceWei.toString(), 
                    recipient: seller 
                }],
                startTime: (Math.floor(Date.now()/1000)).toString(),
                endTime: (Math.floor(Date.now()/1000) + 2592000).toString(), // 30 gün
            };
        });

        notify("Zəhmət olmasa cüzdanda imzalayın...");
        
        const { executeAllActions } = await seaport.createBulkOrders(orderInputs, seller);
        const signedOrders = await executeAllActions(); 

        notify("İmza alındı! Bazaya yazılır...");

        let successCount = 0;
        for (const order of signedOrders) {
            const offerItem = order.parameters.offer[0];
            const tokenStr = offerItem.identifierOrCriteria;

            // BigNumber-ları stringə çevirib bazaya göndəririk
            const plainOrder = orderToJsonSafe(order);
            const orderHash = seaport.getOrderHash(order.parameters);

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
            successCount++;
        }

        notify(`Tamamlandı! ${successCount} NFT satışa çıxdı.`);
        setTimeout(() => location.reload(), 1500);

    } catch (err) {
        console.error("Bulk List Error:", err);
        alert("Satış xətası: " + (err.message || err));
    }
}

async function listNFT(tokenid, priceWei) {
  await bulkListNFTs([tokenid.toString()], priceWei);
}

// ==========================================
// BUY FUNCTION (FIXED: APPROVAL CHECK REMOVED)
// ==========================================

async function buyNFT(nftRecord) {
    if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");
    
    try {
        const buyerAddress = await signer.getAddress();
        
        // Öz NFT-sini almasın
        const nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, ["function ownerOf(uint256) view returns (address)"], provider);
        try {
            const owner = await nftContract.ownerOf(nftRecord.tokenid);
            if (owner.toLowerCase() === buyerAddress.toLowerCase()) return alert("Bu NFT artıq sizindir!");
        } catch(e) {}

        notify("Order yoxlanılır...");
        let rawJson = nftRecord.seaport_order;
        if (!rawJson) return alert("Order tapılmadı.");
        
        if (typeof rawJson === "string") { 
            try { rawJson = JSON.parse(rawJson); } catch (e) { return alert("JSON Parse Xətası"); } 
        }

        // Məlumatı təmizlə və strukturlaşdır
        const cleanOrd = cleanOrder(rawJson);
        if (!cleanOrd) return alert("Order strukturu xətalıdır");

        // DİQQƏT: Buradakı 'isApprovedForAll' yoxlamasını sildik.
        // Səbəb: Satıcı yalnız tək NFT-yə icazə vermiş ola bilər.
        // Bu yoxlamanı Seaport 'fulfillOrder' zamanı özü edəcək.

        notify("Tranzaksiya hazırlanır...");
        
        // Seaport fulfill (İcazə yoxdursa burada xəta verəcək)
        const { actions } = await seaport.fulfillOrder({ 
            order: cleanOrd, 
            accountAddress: buyerAddress 
        });

        const txRequest = await actions[0].transactionMethods.buildTransaction();

        // Transaction dəyərini (Value) düzgün hesabla
        let finalValue = ethers.BigNumber.from(0);

        if (txRequest.value) {
            finalValue = ethers.BigNumber.from(txRequest.value.toString());
        }

        // Əgər value hələ də 0-dırsa, qiyməti consideration-dan tap
        if (finalValue.eq(0) && cleanOrd.parameters.consideration) {
            cleanOrd.parameters.consideration.forEach(c => {
                // ItemType 0 = Native Token (APE)
                if (Number(c.itemType) === 0) { 
                    const amount = c.endAmount ? c.endAmount.toString() : "0";
                    finalValue = finalValue.add(ethers.BigNumber.from(amount));
                }
            });
        }

        // Gas limit hesabla
        let gasLimit = ethers.BigNumber.from("500000");
        try {
            const est = await signer.estimateGas({ 
                to: txRequest.to,
                data: txRequest.data,
                value: finalValue, 
                from: buyerAddress 
            });
            gasLimit = est.mul(120).div(100); 
        } catch(e) {
            console.warn("Gas estimate failed (likely approval missing or balance low):", e);
            // Xüsusi xəta mesajı qaytara bilərik, amma davam edək
        }

        notify("Metamask-da təsdiqləyin...");
        const tx = await signer.sendTransaction({
            to: txRequest.to,
            data: txRequest.data,
            value: finalValue,
            gasLimit
        });

        notify("Blokçeyndə təsdiqlənir...");
        await tx.wait();
        notify("Uğurlu alış!");

        // Bazada satışı qeyd et
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
        // Xəta mesajlarını daha aydın göstər
        let msg = err.message || err;
        if (msg.includes("insufficient funds")) msg = "Balansınız kifayət etmir.";
        else if (msg.includes("user rejected")) msg = "Ləğv edildi.";
        else if (msg.includes("unauthorized")) msg = "Satıcı icazəni ləğv edib (Approval missing).";
        
        alert("Buy Xətası: " + msg);
    }
}

window.loadNFTs = loadNFTs;
