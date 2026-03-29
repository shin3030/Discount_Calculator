const Parser = {
    getItems() {
        return Array.from(document.querySelectorAll('.item-node')).map((n, idx) => {
            const comboType = n.querySelector('.i-combo-type').value;
            const groupTag = n.querySelector('.i-group-tag').value;
            return {
                id: n.dataset.id || `item_${idx}`,
                name: n.querySelector('.i-name').value || `商品${idx + 1}`,
                price: parseFloat(n.querySelector('.i-price').value) || 0,
                count: parseInt(n.querySelector('.i-count').value) || 1,
                groupTag: (comboType === 'none') ? 'none' : (groupTag || 'none'),
                comboType: comboType,
                v1: parseFloat(n.querySelector('.v1').value) || 0,
                v2: parseFloat(n.querySelector('.v2').value) || 0
            };
        }).filter(i => i.price > 0 && i.count > 0);
    },
    getCoupons() {
        return Array.from(document.querySelectorAll('.coupon-node')).map((n, idx) => {
            const excluded = Array.from(n.querySelectorAll('.exclude-item:checked')).map(cb => cb.value);
            return {
                id: idx,
                min: parseFloat(n.querySelector('.c-min').value) || 0,
                type: n.querySelector('.c-type').value,
                val: parseFloat(n.querySelector('.c-val').value) || 0,
                max: parseFloat(n.querySelector('.c-max').value) || Infinity,
                count: parseInt(n.querySelector('.c-count').value) || 0,
                excludedItems: excluded
            };
        }).filter(c => c.count > 0);
    },
    getSettings() {
        return {
            shipFee: parseFloat(document.getElementById('shipFee').value) || 0,
            freeLimit: parseFloat(document.getElementById('freeLimit').value) || 0
        };
    }
};

const Calculator = {
    memo: new Map(),

    // 重新編寫：全局最低價優先折抵邏輯
    calculateGroupPrice(groupItems) {
        if (groupItems.length === 0) return 0;
        
        // 取得該群組定義的優惠規則
        const ruleItem = groupItems.find(i => i.comboType !== 'none' && i.comboType !== 'isGroupOnly') || groupItems[0];
        const { comboType, v1, v2 } = ruleItem;

        // 打散所有商品成單價清單，並「由小到大」排序 [80, 100, 200, 200]
        let priceList = [];
        groupItems.forEach(item => {
            for(let i=0; i<item.count; i++) priceList.push(item.price);
        });
        priceList.sort((a, b) => a - b); 

        if (comboType === 'none' || comboType === 'isGroupOnly' || v1 <= 0) {
            return priceList.reduce((s, p) => s + p, 0);
        }

        let finalTotal = 0;
        const totalItems = priceList.length;

        switch (comboType) {
            case 'buyXgetY': {
                // 邏輯：買 X 送 Y。計算總共有幾組，一組送 Y 件。
                // 優先讓最便宜的「Y * 組數」件免費。
                const groupSize = v1 + v2;
                const numGroups = Math.floor(totalItems / groupSize);
                const freeCount = numGroups * v2;

                // 從最小的開始算，前 freeCount 個免費
                for (let i = 0; i < totalItems; i++) {
                    if (i < freeCount) finalTotal += 0;
                    else finalTotal += priceList[i];
                }
                return finalTotal;
            }

            case 'fullXdiscount': {
                const sum = priceList.reduce((s, p) => s + p, 0);
                return totalItems >= v1 ? sum * (v2 / 100) : sum;
            }

            case 'nthDiscount': {
                // 邏輯：第 X 件打 Y 折。計算總共有幾件可以打折。
                // 優先讓最便宜的「打折件數」件打折。
                const discountCount = Math.floor(totalItems / v1);

                for (let i = 0; i < totalItems; i++) {
                    if (i < discountCount) finalTotal += priceList[i] * (v2 / 100);
                    else finalTotal += priceList[i];
                }
                return finalTotal;
            }
            default: return priceList.reduce((s, p) => s + p, 0);
        }
    },

    solve(items, couponTypes, settings) {
        this.memo.clear();
        const initialCounts = couponTypes.map(c => c.count);
        return this.getBest((1 << items.length) - 1, initialCounts, items, couponTypes, settings);
    },

    getBest(mask, counts, items, coupons, settings) {
        if (mask === 0) return { cost: 0, steps: [] };
        const key = `${mask}_${counts.join(',')}`;
        if (this.memo.has(key)) return this.memo.get(key);

        let best = { cost: Infinity, steps: [] };
        for (let submask = mask; submask > 0; submask = (submask - 1) & mask) {
            const subItems = items.filter((_, idx) => (submask >> idx) & 1);
            const groups = {};
            subItems.forEach(item => {
                const tag = item.groupTag === 'none' ? `single_${item.id}` : item.groupTag;
                if (!groups[tag]) groups[tag] = [];
                groups[tag].push(item);
            });

            let subBasePrice = 0;
            Object.keys(groups).forEach(tag => subBasePrice += this.calculateGroupPrice(groups[tag]));

            let options = [];
            let s0 = subBasePrice >= settings.freeLimit ? 0 : settings.shipFee;
            options.push({ cost: subBasePrice + s0, couponIdx: -1, disc: 0, ship: s0 });

            counts.forEach((qty, idx) => {
                if (qty > 0) {
                    const cp = coupons[idx];
                    let couponEligiblePrice = 0;
                    Object.keys(groups).forEach(tag => {
                        const isExcluded = cp.excludedItems.includes(tag) || 
                                          groups[tag].some(it => cp.excludedItems.includes(it.name));
                        if (!isExcluded) couponEligiblePrice += this.calculateGroupPrice(groups[tag]);
                    });

                    if (couponEligiblePrice >= cp.min && couponEligiblePrice > 0) {
                        let d = cp.type === 'fixed' ? cp.val : Math.min(couponEligiblePrice * (cp.val / 100), cp.max || Infinity);
                        let after = subBasePrice - d;
                        let s = after >= settings.freeLimit ? 0 : settings.shipFee;
                        options.push({ cost: after + s, couponIdx: idx, disc: d, ship: s });
                    }
                }
            });

            options.sort((a, b) => a.cost - b.cost);
            const opt = options[0];
            const nextCounts = [...counts];
            if (opt.couponIdx !== -1) nextCounts[opt.couponIdx]--;
            const sub = this.getBest(mask ^ submask, nextCounts, items, coupons, settings);
            if (sub.cost !== Infinity && (opt.cost + sub.cost) < best.cost) {
                best = { cost: opt.cost + sub.cost, steps: [{ items: subItems, ...opt, basePrice: subBasePrice }, ...sub.steps] };
            }
        }
        this.memo.set(key, best);
        return best;
    }
};

const App = {
    itemCounter: 0,
    init() { this.addItem(); this.addCoupon(); },
    showModal() { document.getElementById('confirmModal').classList.remove('hidden'); },
    closeModal() { document.getElementById('confirmModal').classList.add('hidden'); },
    clearAll() { location.reload(); },
    addItem() {
        this.itemCounter++;
        const container = document.getElementById('itemList');
        const div = document.createElement('div');
        div.className = 'item-node animate-item bg-[#0f1447]/40 p-4 rounded-2xl border border-[#2d346b] space-y-3';
        div.innerHTML = `
            <div class="grid grid-cols-12 gap-3 items-center">
                <div class="col-span-12 md:col-span-4">
                    <input type="text" placeholder="商品名稱" class="i-name input-field" oninput="App.syncExcludeList()">
                </div>
                <div class="col-span-6 md:col-span-3">
                    <div class="flex items-center bg-[#0f1447] rounded-xl px-2 border border-[#2d346b]">
                        <span class="text-[10px] text-slate-500 mr-1">$</span>
                        <input type="number" placeholder="單價" onfocus="this.value=''" class="i-price bg-transparent py-2 w-full outline-none text-sm font-bold text-slate-200">
                    </div>
                </div>
                <div class="col-span-4 md:col-span-3">
                    <div class="flex items-center bg-[#0f1447] rounded-xl px-2 border border-[#2d346b]">
                        <span class="text-[10px] text-slate-500 mr-1">x</span>
                        <input type="number" value="1" onfocus="this.value=''" class="i-count bg-transparent py-2 w-full outline-none text-sm font-bold text-slate-200">
                    </div>
                </div>
                <div class="col-span-2 md:col-span-2 text-right">
                    <button onclick="this.parentElement.parentElement.parentElement.remove(); App.updateCount(); App.syncExcludeList();" class="text-slate-500 hover:text-rose-400 p-1 transition">✕</button>
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-700/30">
                <select class="i-combo-type input-field w-auto min-w-[130px] bg-[#0f1447] text-xs py-1" onchange="App.updateComboUI(this)">
                    <option value="none">無組合優惠</option>
                    <option value="isGroupOnly">組合商品(僅設群組)</option>
                    <option value="buyXgetY">買 X 送 Y</option>
                    <option value="fullXdiscount">滿 X 件 Y 折</option>
                    <option value="nthDiscount">第 X 件 Y 折</option>
                </select>
                <div class="group-tag-area hidden flex items-center gap-2">
                    <span class="text-[11px] font-black text-slate-400 uppercase tracking-widest">群組:</span>
                    <input type="text" placeholder="填入群組名" class="i-group-tag w-32 bg-slate-800 border border-slate-600 rounded-lg text-center text-[14px] py-1 text-blue-400 font-black" oninput="App.syncExcludeList()">
                </div>
                <div class="combo-inputs hidden flex items-center gap-2">
                    <span class="text-xs text-slate-500 lb1">買</span>
                    <input type="number" class="v1 w-10 bg-slate-800 border border-slate-600 rounded-lg text-center text-xs py-1" value="0" onfocus="this.value=''">
                    <span class="text-xs text-slate-500 lb2">送</span>
                    <input type="number" class="v2 w-10 bg-slate-800 border border-slate-600 rounded-lg text-center text-xs py-1" value="0" onfocus="this.value=''">
                    <span class="text-xs text-slate-500 lb3"></span>
                </div>
            </div>
        `;
        container.appendChild(div);
        this.updateCount();
    },
    updateComboUI(el) {
        const row = el.parentElement;
        const groupArea = row.querySelector('.group-tag-area');
        const inputs = row.querySelector('.combo-inputs');
        const lb1 = row.querySelector('.lb1'); const lb2 = row.querySelector('.lb2'); const lb3 = row.querySelector('.lb3');
        const type = el.value;
        if (type === 'none') { groupArea.classList.add('hidden'); inputs.classList.add('hidden'); }
        else if (type === 'isGroupOnly') { groupArea.classList.remove('hidden'); inputs.classList.add('hidden'); }
        else {
            groupArea.classList.remove('hidden'); inputs.classList.remove('hidden');
            if (type === 'buyXgetY') { lb1.innerText='買'; lb2.innerText='送'; lb3.innerText='件'; }
            else if (type === 'fullXdiscount') { lb1.innerText='滿'; lb2.innerText='件折'; lb3.innerText='%'; }
            else if (type === 'nthDiscount') { lb1.innerText='第'; lb2.innerText='件折'; lb3.innerText='%'; }
        }
        this.syncExcludeList();
    },
    addCoupon() {
        const container = document.getElementById('couponList');
        const div = document.createElement('div');
        div.className = 'coupon-node bg-[#0f1447]/50 p-5 rounded-3xl border border-[#2d346b] space-y-4 relative animate-item';
        div.innerHTML = `
            <button onclick="this.parentElement.remove()" class="absolute top-4 right-4 text-slate-500 hover:text-rose-400 transition">✕</button>
            <div class="grid grid-cols-2 gap-4">
                <div><label class="text-[10px] font-black text-slate-500 block mb-1.5 uppercase tracking-widest ml-1">門檻 ($)</label><input type="number" value="0" onfocus="this.value=''" class="c-min input-field"></div>
                <div><label class="text-[10px] font-black text-slate-500 block mb-1.5 uppercase tracking-widest ml-1">優惠類型</label><select class="c-type input-field bg-[#0f1447]"><option value="fixed">金額折抵 ($)</option><option value="percent">百分比 (%)</option></select></div>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div><label class="text-[10px] font-black text-slate-500 block mb-1.5 uppercase tracking-widest ml-1">折抵數值</label><input type="number" value="0" onfocus="this.value=''" class="c-val input-field"></div>
                <div><label class="text-[10px] font-black text-[#f095f8] block mb-1.5 uppercase tracking-widest ml-1">最高上限</label><input type="number" placeholder="不限" onfocus="this.value=''" class="c-max input-field"></div>
                <div><label class="text-[10px] font-black text-[#2d58fa] block mb-1.5 uppercase tracking-widest ml-1">持有數量</label><input type="number" value="1" onfocus="this.value=''" class="c-count input-field font-bold text-[#2d58fa]"></div>
            </div>
            <div class="pt-2 border-t border-slate-700/30">
                <label class="text-[13px] font-black text-rose-400 block mb-3 uppercase tracking-widest ml-1">排除清單 (不可使用此券)</label>
                <div class="exclude-options-container flex flex-wrap gap-3 max-h-40 overflow-y-auto no-scrollbar p-1"></div>
            </div>`;
        container.appendChild(div);
        this.syncExcludeList();
    },
    syncExcludeList() {
        const groupTags = Array.from(document.querySelectorAll('.i-group-tag')).filter(i => !i.parentElement.classList.contains('hidden')).map(i => i.value).filter(v => v);
        const standaloneItems = Array.from(document.querySelectorAll('.item-node')).filter(node => {
            const comboType = node.querySelector('.i-combo-type').value;
            const tag = node.querySelector('.i-group-tag').value;
            return (comboType === 'none' || !tag);
        }).map(node => node.querySelector('.i-name').value).filter(v => v);

        const uniqueOptions = [...new Set([...groupTags, ...standaloneItems])];
        document.querySelectorAll('.exclude-options-container').forEach(container => {
            const currentChecked = Array.from(container.querySelectorAll('input:checked')).map(cb => cb.value);
            container.innerHTML = uniqueOptions.map(opt => `
                <label class="exclude-label relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" value="${opt}" class="exclude-item hidden" ${currentChecked.includes(opt) ? 'checked' : ''}>
                    <span class="exclude-text px-4 py-2 rounded-xl transition-all active:scale-95">
                        ${opt}
                    </span>
                </label>
            `).join('');
        });
    },
    updateCount() { document.getElementById('itemCount').innerText = `${document.querySelectorAll('.item-node').length} 項目`; },
    runAnalysis() {
        const items = Parser.getItems();
        const result = Calculator.solve(items, Parser.getCoupons(), Parser.getSettings());
        this.render(result, items, Parser.getSettings());
    },
    render(result, items, settings) {
        document.getElementById('resultArea').classList.remove('hidden');
        document.getElementById('totalBest').innerText = Math.round(result.cost);
        const originalRawSum = items.reduce((s, i) => s + (i.price * i.count), 0);
        document.getElementById('totalSaved').innerText = Math.max(0, Math.round(originalRawSum - result.cost));
        const container = document.getElementById('orderDetails');
        container.innerHTML = "";
        result.steps.forEach((step, i) => {
            const card = document.createElement('div');
            card.className = "card border-slate-700/50 shadow-soft mb-4 animate-item";
            const groups = {};
            step.items.forEach(it => {
                const tag = it.groupTag === 'none' ? '單品' : `群組: ${it.groupTag}`;
                if (!groups[tag]) groups[tag] = [];
                groups[tag].push(it);
            });
            let itemsHtml = "";
            Object.keys(groups).forEach(tag => {
                const subT = Calculator.calculateGroupPrice(groups[tag]);
                itemsHtml += `
                    <div class="mb-2 border-l-2 border-slate-600 pl-3">
                        <div class="text-[11px] text-slate-500 mb-1 font-black uppercase tracking-wider">${tag}</div>
                        ${groups[tag].map(it => `<div class="flex justify-between text-xs text-slate-300"><span>${it.name} x${it.count} ($${it.price})</span><span>$${it.price * it.count}</span></div>`).join('')}
                        <div class="text-right text-[12px] text-[#f095f8] font-black mt-1">優惠後金額: $${Math.round(subT)}</div>
                    </div>`;
            });
            card.innerHTML = `<div class="flex justify-between mb-4"><span class="text-[10px] font-black bg-slate-800 px-3 py-1 rounded-full text-slate-400 uppercase tracking-widest">訂單 ${i + 1}</span></div>
                <div class="space-y-3 mb-4">${itemsHtml}</div>
                <div class="border-t border-slate-700/50 pt-4 space-y-1.5">
                    <div class="flex justify-between text-xs text-slate-500"><span>優惠券折扣</span><span>-$${Math.round(step.disc)}</span></div>
                    <div class="flex justify-between text-xs text-slate-500"><span>運費</span><span>+$${Math.round(step.ship)}</span></div>
                    <div class="flex justify-between text-xl font-black text-[#2d58fa] pt-2"><span>應付總額</span><span>$${Math.round(step.cost)}</span></div>
                </div>`;
            container.appendChild(card);
        });
    }
};
App.init();