import csv, html, json, os, sqlite3, sys, webbrowser
from datetime import date
from decimal import Decimal
from pathlib import Path
import tkinter as tk
from tkinter import ttk, messagebox, filedialog
from labels import label, page as labels_page
from store import Store, money, qty, fixed, today

ROOT=Path(__file__).resolve().parent
DEMO='--demo' in sys.argv
DATA=Path(os.getenv('LOCALAPPDATA') or Path.home())/'MadhuramPOS'/('practice' if DEMO else 'store')
DATA.mkdir(parents=True,exist_ok=True)
store=Store(DATA/'counter.sqlite',ROOT/'Madhuram_20000_SKUs.csv')
db=store.db
if DEMO and not db.execute('select 1 from lot limit 1').fetchone():
    for sku,name,cat,unit,rate,cost,stock in [('TRYAPPLE','Apple · loose','Fruit','kg',180,120,12),('TRYRICE','Ponni rice · 1 kg','Rice & millets','pack',75,60,20)]:
        store.setup(sku,name,'Practice',cat,unit,'',rate,rate)
        store.receive(sku,stock,cost,'Practice supplier','DEMO-01','','')
    store.open('Practice cashier',500)

app=tk.Tk();app.title('Madhuram | Store counter'+(' — Practice' if DEMO else ''));app.geometry('1190x780');app.minsize(840,580)
style=ttk.Style();style.theme_use('clam')
green='#14543c';bg='#f4f7f2';ink='#18392f'
style.configure('.',font=('Segoe UI',10),background=bg,foreground=ink)
style.configure('TButton',padding=(9,6));style.configure('Accent.TButton',background=green,foreground='white')
style.map('Accent.TButton',background=[('active','#216e50')])
style.configure('Treeview',background='white',fieldbackground='white',rowheight=30)
style.configure('Treeview.Heading',font=('Segoe UI',10,'bold'),padding=5)
style.configure('TNotebook.Tab',padding=(9,8))
head=tk.Frame(app,bg=green,padx=18,pady=10);head.pack(fill='x')
tk.Label(head,text='Madhuram  /  Pazhamudhir Cholai',bg=green,fg='white',font=('Segoe UI',18,'bold')).pack(side='left')
tk.Label(head,text='PRACTICE COUNTER' if DEMO else 'STORE COUNTER',bg=green,fg='white').pack(side='right')
tabs=ttk.Notebook(app);tabs.pack(fill='both',expand=True,padx=12,pady=10)
pages={}
for name in ('Billing','Products','Stock','Purchasing','Receipts','Reports','Shift & backup'):
    pages[name]=ttk.Frame(tabs,padding=10);tabs.add(pages[name],text=name)
notice=tk.StringVar(value='Practice codes: TRYAPPLE (kg) and TRYRICE (1 kg pack).' if DEMO else 'Open a shift, configure a product and receive stock to start billing.')
ttk.Label(app,textvariable=notice,padding=(14,7)).pack(anchor='w')

def guard(fn):
    def run(*args):
        try:return fn(*args)
        except (ValueError,sqlite3.Error,OSError,KeyError,OverflowError) as e:messagebox.showerror('Check entry',str(e),parent=app)
    return run
def button(parent,label,fn,accent=False):
    b=ttk.Button(parent,text=label,command=guard(fn),style='Accent.TButton' if accent else 'TButton');b.pack(side='left',padx=(0,6),pady=4);return b
def bar(parent):
    f=ttk.Frame(parent);f.pack(fill='x',pady=3);return f
def field(parent,label,value='',width=16):
    ttk.Label(parent,text=label).pack(side='left',padx=(0,4));v=tk.StringVar(value=value)
    e=ttk.Entry(parent,textvariable=v,width=width);e.pack(side='left',padx=(0,8));return v,e
def table(parent,columns,widths):
    f=ttk.Frame(parent);f.pack(fill='both',expand=True,pady=5)
    t=ttk.Treeview(f,columns=columns,show='headings',selectmode='browse')
    for k,w in zip(columns,widths):t.heading(k,text=k);t.column(k,width=w,minwidth=45)
    y=ttk.Scrollbar(f,command=t.yview);x=ttk.Scrollbar(f,orient='horizontal',command=t.xview)
    t.configure(yscrollcommand=y.set,xscrollcommand=x.set)
    t.grid(row=0,column=0,sticky='nsew');y.grid(row=0,column=1,sticky='ns');x.grid(row=1,column=0,sticky='ew')
    f.rowconfigure(0,weight=1);f.columnconfigure(0,weight=1);return t
def fill(t,rows):
    t.delete(*t.get_children())
    for row in rows:t.insert('','end',values=tuple(row))
def selected(t):
    if not t.selection():raise ValueError('Select a row first.')
    return t.item(t.selection()[0],'values')
def dialog(title,fields,fn):
    w=tk.Toplevel(app);w.title(title);w.transient(app);w.grab_set()
    body=ttk.Frame(w,padding=16);body.pack();vs=[]
    for i,(label,default) in enumerate(fields):
        ttk.Label(body,text=label).grid(row=i,column=0,sticky='w',pady=4)
        v=tk.StringVar(value=default);e=ttk.Entry(body,textvariable=v,width=52);e.grid(row=i,column=1,pady=4);vs.append(v)
        if i==0:e.focus()
    def submit():
        fn(*(v.get().strip() for v in vs));w.destroy()
    b=ttk.Frame(body);b.grid(row=len(fields),column=1,sticky='e');button(b,'Cancel',w.destroy);button(b,'Save',submit,True)
def export(t):
    dest=filedialog.asksaveasfilename(defaultextension='.csv',filetypes=[('CSV','*.csv')])
    if dest:
        with open(dest,'w',newline='',encoding='utf-8-sig') as f:
            w=csv.writer(f);w.writerow(t['columns'])
            for r in t.get_children():w.writerow([("'"+v if isinstance(v,str) and v.startswith(('=','+','-','@')) else v) for v in t.item(r,'values')])
        notice.set('Export saved.')
# Checkout
pg=pages['Billing'];b=bar(pg);scan,scan_entry=field(b,'Barcode / SKU',width=24);units,_=field(b,'Qty / kg','1',9)
cart={};held_id=None
def refresh_cart():
    rows=store.quote(cart) if cart else []
    fill(lines,[(p['sku'],p['name'],qty(q),p['unit'],money(p['price']),money(a)) for p,q,a in rows])
    total.set('Total   ₹ '+money(sum(r[2] for r in rows)))
def add():
    p=store.item(scan.get().strip());q=store.quantity(p,units.get())
    if not p['price']:raise ValueError('Set the selling price in Products first.')
    sku=p['sku'];cart[sku]=str(Decimal(cart.get(sku,'0'))+Decimal(q)/1000)
    refresh_cart();scan.set('');units.set('1');scan_entry.focus()
button(b,'Add to bill',add,True);scan_entry.bind('<Return>',guard(lambda e:add()))
def drop():
    del cart[selected(lines)[0]];refresh_cart()
button(b,'Remove line',drop)
def editqty():
    sku=selected(lines)[0]
    def change(v):
        store.quantity(store.item(sku),v);cart[sku]=v;refresh_cart()
    dialog('Change quantity',[('Quantity / kg',cart[sku])],change)
button(b,'Edit quantity',editqty)
lines=table(pg,('SKU','Product / pack','Quantity','Unit','Rate ₹','Amount ₹'),(90,420,85,60,90,100))
b=bar(pg);total=tk.StringVar(value='Total   ₹ 0.00');ttk.Label(b,textvariable=total,font=('Segoe UI',20,'bold')).pack(side='right')
customer,_=field(b,'Customer (optional)',width=22)
b=bar(pg);method=tk.StringVar(value='Cash');ttk.Combobox(b,textvariable=method,values=('Cash','UPI','Card'),state='readonly',width=8).pack(side='left',padx=6)
tender,_=field(b,'Cash received ₹',width=12)
def reset():
    global held_id
    cart.clear();held_id=None;customer.set('');tender.set('');scan.set('');units.set('1');refresh_cart();scan_entry.focus()
def checkout():
    refresh_cart()
    rows=store.quote(cart);value=money(sum(x[2] for x in rows))
    if not messagebox.askyesno('Confirm payment',f'Record ₹{value} by {method.get()}? Confirm payment has been received.'):return
    bill=store.checkout(cart,method.get(),tender.get(),customer.get(),held_id)
    reset();refresh_all();receipt(bill)
button(b,'Complete sale',checkout,True)
def hold():
    global held_id
    store.quote(cart)
    def save(label):
        if not label:raise ValueError('Enter a bill label.')
        payload=json.dumps([cart,customer.get()])
        if held_id:db.execute('update held set label=?,cart=? where id=?',(label,payload,held_id))
        else:db.execute('insert into held(label,cart) values(?,?)',(label,payload))
        reset();notice.set('Bill held.')
    dialog('Hold bill',[('Bill label',customer.get())],save)
button(b,'Hold',hold)
def recall():
    global held_id
    if cart:raise ValueError('Hold or clear the current basket first.')
    w=tk.Toplevel(app);w.title('Held bills');t=table(w,('ID','Label'),(70,220));fill(t,db.execute('select id,label from held order by id'))
    def load():
        global held_id
        held_id=int(selected(t)[0]);items,c=json.loads(db.execute('select cart from held where id=?',(held_id,)).fetchone()[0])
        cart.update(items);customer.set(c);refresh_cart();w.destroy();scan_entry.focus()
    button(bar(w),'Recall selected',load)
button(b,'Recall',recall)
def clear():
    if messagebox.askyesno('Clear current basket','Clear the current basket? A previously held copy stays available.'):reset()
button(b,'Clear',clear)
# Products
pg=pages['Products'];b=bar(pg);query,search=field(b,'Find name, pack, SKU or barcode',width=30)
cats=['All categories']+[r[0] for r in db.execute('select distinct category from product order by 1')]
cat=tk.StringVar(value=cats[0]);cb=ttk.Combobox(b,textvariable=cat,values=cats,state='readonly');cb.pack(side='left')
page=0;page_label=tk.StringVar()
def products(n=0):
    global page
    page=max(0,n);q=query.get().strip()
    cond="where (?='All categories' or category=?) and (name like ? or sku=? or barcode=?)"
    args=(cat.get(),cat.get(),'%'+q+'%',q.upper(),q)
    count=db.execute('select count(*) from product '+cond,args).fetchone()[0]
    page=min(page,max(0,(count-1)//100))
    rows=db.execute('select * from product '+cond+' order by sku limit 100 offset ?',(*args,page*100))
    fill(pt,[(r['sku'],r['name'],r['category'],r['barcode'] or '',money(r['price']) if r['price'] else '—',r['unit']) for r in rows])
    page_label.set(f'{count:,} matches · Page {page+1} of {max(1,(count+99)//100)}')
button(b,'Search',products);search.bind('<Return>',guard(lambda e:products()));cb.bind('<<ComboboxSelected>>',guard(lambda e:products()))
pt=table(pg,('SKU','Product / pack','Category','Pack barcode','Rate ₹','Unit'),(90,380,170,140,85,60))
def product(edit):
    p=store.item(selected(pt)[0]) if edit else {}
    fields=[('SKU','sku'),('Product / pack name','name'),('Department','dept'),('Category','category'),('Sale unit (pack or kg)','unit'),('Scan pack barcode (optional)','barcode'),('Selling price ₹','price'),('MRP / loose price ceiling ₹','mrp')]
    vals=[]
    for label,k in fields:
        v=p[k] if edit else ('pack' if k=='unit' else '')
        vals.append((label,str(Decimal(v)/100) if v and k in ('price','mrp') else v or ''))
    def save(*v):
        if edit and v[0]!=p['sku']:raise ValueError('Use New product to assign a different SKU.')
        store.setup(*v);cb.configure(values=['All categories']+[r[0] for r in db.execute('select distinct category from product order by 1')]);products(page);notice.set('Product saved.')
    dialog('Product details',vals,save)
def to_bill():
    sku=selected(pt)[0];tabs.select(pages['Billing']);scan.set(sku);scan_entry.focus()
b=bar(pg);button(b,'Edit / link barcode',lambda:product(True),True);button(b,'New product',lambda:product(False));button(b,'Use in bill',to_bill)
button(b,'Previous',lambda:products(page-1));button(b,'Next',lambda:products(page+1));ttk.Label(b,textvariable=page_label).pack(side='right')
# Inventory
pg=pages['Stock'];b=bar(pg);stockq,_=field(b,'Find SKU, supplier or lot',width=26)
def stocks():
    q='%'+stockq.get().strip()+'%';fill(st,[(r['id'],r['sku'],r['name'],qty(r['qty']),r['unit'],money(r['cost']),r['supplier'],r['reference'],r['batch'],r['expiry'] or '') for r in db.execute("""select l.*,p.name,p.unit from lot l join product p using(sku) where l.sku like ? or l.supplier like ? or l.batch like ? order by l.id desc""",(q,q,q))])
button(b,'Find lots',stocks)
def receive(default=''):
    def save(*vals):
        store.receive(*vals);stocks();notice.set('Stock received and recorded in the movement ledger.')
    dialog('Receive supplier stock',[('Scan barcode or SKU',default),('Quantity (packs or kg)','1'),('Purchase cost per pack / kg ₹',''),('Supplier',''),('Supplier invoice reference',''),('Batch / lot',''),('Expiry YYYY-MM-DD (optional)','')],save)
button(b,'Receive stock',receive,True)
def waste():
    lot=selected(st)[0]
    def save(v,r):
        store.waste(lot,v,r);stocks()
    dialog('Write off stock',[('Quantity','1'),('Reason','')],save)
button(b,'Damage / waste',waste);button(b,'Export lots',lambda:export(st))
st=table(pg,('Lot','SKU','Product','Available','Unit','Cost ₹','Supplier','Invoice','Batch','Expiry'),(55,85,220,80,50,70,110,80,70,90))
product_actions=bar(pages['Products'])
button(product_actions,'Receive selected product',lambda:receive(selected(pt)[0]))
def import_csv():
    path=filedialog.askopenfilename(filetypes=[('Product catalogue CSV','*.csv')])
    if path and messagebox.askyesno('Import product updates','Apply populated rows, including their barcode and price fields?'):
        count=store.import_products(path);products(page);notice.set(f'{count:,} product updates saved.')
button(product_actions,'Import priced CSV',import_csv)
def set_tax():
    sku=selected(pt)[0];r=db.execute('select * from tax where sku=?',(sku,)).fetchone()
    dialog('Inclusive local GST · '+sku,[('Verified HSN',r['hsn'] if r else ''),('Total GST %',r['rate']/100 if r else '')],lambda h,g:store.set_tax(sku,h,g))
button(product_actions,'Set HSN / GST',set_tax)
def print_label():
    sku=selected(pt)[0];p=store.item(sku);dest=DATA/'store-label.html'
    dest.write_text(labels_page([label(sku,p['name'])]),encoding='utf-8');webbrowser.open(dest.as_uri())
button(product_actions,'Print SKU label',print_label)
pg=pages['Purchasing'];b=bar(pg)
def orders():
    fill(ot,[(r['id'],r['supplier'],r['sku'],r['name'],qty(r['qty']),qty(r['received']),qty(r['qty']-r['received']),money(r['cost']),r['due']) for r in db.execute('select o.*,p.name from orders o join product p using(sku) order by o.id desc')])
def new_order():
    def save(*vs):store.order(*vs);orders()
    dialog('Order a supplier item',[('Supplier',''),('SKU / barcode',''),('Order quantity',''),('Agreed unit cost ₹',''),('Due date',today())],save)
def receive_order():
    k=selected(ot)[0];r=db.execute('select * from orders where id=?',(k,)).fetchone()
    def save(v,ref,batch,exp):
        store.receive(r['sku'],v,Decimal(r['cost'])/100,r['supplier'],ref,batch,exp,k);orders();stocks()
    dialog('Receive against order '+k,[('Quantity',qty(r['qty']-r['received'])),('Supplier invoice',''),('Batch',''),('Expiry (optional)','')],save)
button(b,'Order item',new_order,True);button(b,'Receive against order',receive_order);button(b,'Export orders',lambda:export(ot))
ot=table(pg,('Order','Supplier','SKU','Item','Ordered','Received','Outstanding','Unit cost ₹','Due'),(60,110,80,210,75,75,85,80,95))
# Receipts
pg=pages['Receipts'];b=bar(pg);billq,_=field(b,'Bill number or customer',width=24)
def sales():
    q=billq.get().strip();fill(sales_t,[(r['id'],r['time'],r['cashier'],r['customer'],r['method'],money(r['total']),money(r['tender']-r['total'])) for r in db.execute("select s.*,h.cashier from sale s join shift h on h.id=s.shift_id where cast(s.id as text)=? or customer like ? order by s.id desc",(q,'%'+q+'%'))])
button(b,'Search',sales);button(b,'Open receipt',lambda:receipt(int(selected(sales_t)[0])),True)
sales_t=table(pg,('Bill','Local time','Cashier','Customer','Tender','Billed ₹','Change ₹'),(65,160,140,160,75,90,80))
def receipt(i):
    s=db.execute('select s.*,h.cashier from sale s join shift h on s.shift_id=h.id where s.id=?',(i,)).fetchone()
    w=tk.Toplevel(app);w.title(f'Bill MPC-{i:06d}');w.geometry('920x460')
    ttk.Label(w,text=f'Madhuram  ·  MPC-{i:06d}   |   {s["time"]}   |   {s["method"]}',padding=12,font=('Segoe UI',14,'bold')).pack(anchor='w')
    t=table(w,('Line','Product','Qty','Unit','Rate ₹','Amount ₹','Status'),(50,280,65,55,80,85,95))
    def draw():
        fill(t,[(r['id'],r['name'],qty(r['qty']),r['unit'],money(r['price']),money(r['total']),'Refunded' if r['rid'] else 'Sold') for r in db.execute('select l.*,r.id rid from line l left join refund r on l.id=r.line_id where sale_id=? order by l.id',(i,))])
    draw();foot=f'Total ₹{money(s["total"])}    Received ₹{money(s["tender"])}    Change ₹{money(s["tender"]-s["total"])}'
    ttk.Label(w,text=foot,padding=8).pack(anchor='e');b=bar(w)
    def printbill():
        esc=lambda v:html.escape(str(v))
        header=f'MPC-{i:06d} · {s["time"]}<br>Cashier: {esc(s["cashier"])} · {esc(s["method"])}<br>Customer: {esc(s["customer"] or "Walk-in")}'
        profile=db.execute('select * from bill_profile where sale_id=?',(i,)).fetchone()
        if profile:header=f'{esc(profile["legal"])}<br>{esc(profile["address"])}<br>GSTIN {esc(profile["gstin"] or "—")}<br>'+header
        taxrows=db.execute('select l.name,t.* from line_tax t join line l on l.id=t.line_id where l.sale_id=?',(i,))
        breakdown=''.join(f'<tr><td>{esc(r["name"])}</td><td>{esc(r["hsn"])}</td><td>{r["rate"]/100:g}%</td><td>{money(r["base"])}</td><td>{money(r["central"])}</td><td>{money(r["state"])}</td></tr>' for r in taxrows)
        taxtable='<h3>Inclusive local tax</h3><table><tr><th>Item</th><th>HSN</th><th>GST</th><th>Taxable ₹</th><th>CGST ₹</th><th>SGST ₹</th></tr>'+breakdown+'</table>' if breakdown else ''
        rows=''.join('<tr>'+''.join('<td>'+esc(v)+'</td>' for v in t.item(k,'values')[1:])+'</tr>' for k in t.get_children())
        dest=DATA/f'receipt-{i}.html'
        dest.write_text('<meta charset="utf-8"><title>Store receipt</title><style>body{font:15px sans-serif;max-width:720px;margin:24px auto}td,th{padding:6px;text-align:left;border-bottom:1px solid #ccc}@media print{button{display:none}}</style><h2>Madhuram Pazhamudhir Cholai</h2>'+header+'<table><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Rate ₹</th><th>Amount ₹</th><th>Status</th></tr>'+rows+'</table>'+taxtable+'<p>'+foot+'</p><button onclick="print()">Print receipt</button>',encoding='utf-8');webbrowser.open(dest.as_uri())
    button(b,'Printable receipt',printbill,True)
    def ret():
        line=selected(t)[0]
        def save(reason):
            store.refund(line,reason);draw();refresh_all();notice.set('Return recorded. Settle the refund using the original tender and isolate the returned goods.')
        dialog('Return entire selected line',[('Reason','')],save)
    button(b,'Refund selected line',ret)
# Report builder: event-period accounting keeps returns in the day money went out.
REPORTS={
 'Local tax after returns': [('HSN','GST %','Taxable ₹','CGST ₹','SGST ₹'),"with e as (select t.hsn,t.rate,t.base,t.central,t.state from line_tax t join line l on l.id=t.line_id join sale s on s.id=l.sale_id where substr(s.time,1,10) between ? and ? union all select t.hsn,t.rate,-t.base,-t.central,-t.state from line_tax t join refund r on r.line_id=t.line_id where substr(r.time,1,10) between ? and ?) select hsn,rate/100.,sum(base)/100.,sum(central)/100.,sum(state)/100. from e group by hsn,rate"],
 'Expense register': [('Date','Shift','Category','Method','Amount ₹','Reference'),"select time,shift_id,category,method,amount/100.,note from spend where substr(time,1,10) between ? and ? order by id desc"],
 'Local tax on sales': [('HSN','GST %','Taxable ₹','CGST ₹','SGST ₹'),"select hsn,rate/100.,sum(base)/100.,sum(central)/100.,sum(state)/100. from line_tax t join line l on l.id=t.line_id join sale s on s.id=l.sale_id where substr(s.time,1,10) between ? and ? group by hsn,rate"],
 'Category sales': [('Category','Gross ₹','Refunds ₹','Net ₹','Sold lines'),"""with events as (
 select category,l.total gross,0 refund,1 n from line l join sale s on s.id=l.sale_id where substr(s.time,1,10) between ? and ?
 union all select category,0,r.total,0 from refund r join line l on l.id=r.line_id where substr(r.time,1,10) between ? and ?)
 select category,round(sum(gross)/100.,2),round(sum(refund)/100.,2),round(sum(gross-refund)/100.,2),sum(n) from events group by category order by sum(gross-refund) desc"""],
 'Daily sales': [('Date','Bills','Gross ₹','Refunds ₹','Net ₹'),"""with e as (
 select substr(time,1,10) d,1 n,total g,0 r from sale where substr(time,1,10) between ? and ?
 union all select substr(time,1,10),0,0,total from refund where substr(time,1,10) between ? and ?)
 select d,sum(n),round(sum(g)/100.,2),round(sum(r)/100.,2),round(sum(g-r)/100.,2) from e group by d order by d desc"""],
 'Tender summary': [('Tender','Billed ₹','Returned ₹','Net ₹'),"""with e as (
 select method,total g,0 r from sale where substr(time,1,10) between ? and ?
 union all select method,0,total from refund where substr(time,1,10) between ? and ?)
 select method,round(sum(g)/100.,2),round(sum(r)/100.,2),round(sum(g-r)/100.,2) from e group by method"""],
 'SKU performance': [('SKU','Product at sale','Quantity sold','Sales ₹','Cost of sales ₹','Margin before returns ₹'),"""select sku,name,round(sum(qty)/1000.,3),round(sum(l.total)/100.,2),round(sum(cost)/100.,2),round(sum(l.total-cost)/100.,2) from line l join sale s on s.id=l.sale_id where substr(s.time,1,10) between ? and ? group by sku,name order by sum(l.total) desc"""],
 'Purchases': [('Supplier','Invoice','Received','SKU','Batch','Quantity','Cost ₹'),"""select supplier,l.reference,received,sku,batch,round(m.delta/1000.,3),round(m.delta*l.cost/100000.,2) from lot l join movement m on m.lot_id=l.id and m.reason='Receipt' where substr(received,1,10) between ? and ? order by received desc"""],
 'Stock movements': [('Time','SKU','Lot','Qty change','Type','Reference / reason'),"""select time,sku,lot_id,round(delta/1000.,3),reason,m.reference from movement m join lot l on l.id=m.lot_id where substr(time,1,10) between ? and ? order by m.id desc"""],
 'Expiry window': [('Expiry','SKU','Product','Batch','Available','Unit'),"""select expiry,sku,name,batch,round(qty/1000.,3),unit from lot join product using(sku) where expiry between ? and ? and qty>0 order by expiry"""],
 'Refund register': [('Time','Bill','Product','Reason','Tender','Refund ₹'),"""select time,sale_id,name,reason,method,round(r.total/100.,2) from refund r join line l on l.id=r.line_id where substr(time,1,10) between ? and ? order by r.id desc"""],
 'Shift reconciliation': [('Shift','Cashier','Opened','Closed','Float ₹','Counted ₹','Difference ₹'),"""select id,cashier,opened,coalesce(closed,'Open'),opening/100.,coalesce(counted/100.,''),coalesce(variance/100.,'') from shift where substr(opened,1,10) between ? and ? order by id desc"""],
 'Stock valuation today': [('SKU','Product','Category','Unit','Stock','At cost ₹'),"""select sku,name,category,unit,round(sum(qty)/1000.,3),round(sum(qty*cost)/100000.,2) from lot join product using(sku) where qty>0 group by sku order by category,name"""],
 'Reorder shortlist today': [('SKU','Product','Available','Unit'),"""select p.sku,p.name,round(coalesce(sum(case when expiry is null or expiry>=date('now','localtime') then qty else 0 end),0)/1000.,3) available,p.unit from product p left join lot l on l.sku=p.sku where p.price is not null group by p.sku having available<=5 order by available,p.name"""]
}
pg=pages['Reports'];b=bar(pg);report=tk.StringVar(value='Category sales')
ttk.Combobox(b,textvariable=report,state='readonly',values=list(REPORTS),width=24).pack(side='left',padx=5)
start,_=field(b,'From',today(),11);end,_=field(b,'To',today(),11)
report_frame=ttk.Frame(pg);report_frame.pack(fill='both',expand=True)
rt=None
def reports():
    global rt
    cols,sql=REPORTS[report.get()]
    a,b=start.get(),end.get()
    if sql.count('?') and date.fromisoformat(a)>date.fromisoformat(b):raise ValueError('Start date must be on or before the end date.')
    rows=list(db.execute(sql,(a,b)*(sql.count('?')//2)))
    for child in report_frame.winfo_children():child.destroy()
    rt=table(report_frame,cols,[130]*len(cols));fill(rt,rows)
    notice.set(f'{report.get()} · {len(rows)} rows')
button(b,'Run report',reports,True);button(b,'Export CSV',lambda:export(rt))
# Shift management and consistent SQLite backup
pg=pages['Shift & backup'];status=tk.StringVar()
ttk.Label(pg,textvariable=status,font=('Segoe UI',16,'bold'),padding=10).pack(anchor='w')
def shift_status():
    try:
        s=store.active();status.set(f'Shift {s["id"]}   ·   {s["cashier"]}   ·   Expected cash ₹{money(store.expected(s))}')
    except ValueError:status.set('Counter closed')
def openshift():
    def save(n,c):store.open(n,c);shift_status()
    dialog('Open a shift',[('Cashier name',''),('Opening drawer cash ₹','0')],save)
def closeshift():
    s=store.active()
    def save(v):
        diff=store.close(v);shift_status();notice.set('Shift closed. Counted minus expected ₹'+money(diff))
    dialog(f'Close shift {s["id"]}',[('Physical drawer count ₹','')],save)
def backup():
    dest=filedialog.asksaveasfilename(defaultextension='.sqlite',initialfile='Madhuram-'+today()+'.sqlite',filetypes=[('SQLite database','*.sqlite')])
    if dest:
        if Path(dest).resolve()==(DATA/'counter.sqlite').resolve():raise ValueError('Select a separate backup location.')
        tmp=Path(dest).with_name(Path(dest).name+'.tmp-'+str(os.getpid()))
        try:
            c=sqlite3.connect(tmp)
            try:db.backup(c);assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
            finally:c.close()
            tmp.replace(dest)
        finally:tmp.unlink(missing_ok=True)
        notice.set('Verified database backup saved.')
b=bar(pg);button(b,'Open shift',openshift,True);button(b,'Close & reconcile',closeshift);button(b,'Save database backup',backup)
def profile():
    r=db.execute('select * from retail_profile where id=1').fetchone()
    def save(n,a,g):
        if not n or not a or (g and (len(g)!=15 or not g.isalnum())):raise ValueError('Enter store details and check the GSTIN.')
        db.execute('insert or replace into retail_profile values(1,?,?,?)',(n,a,g.upper()))
    dialog('Store receipt identity',[('Legal store name',r['legal'] if r else ''),('Store address',r['address'] if r else ''),('GSTIN if applicable',r['gstin'] if r else '')],save)
def expense():
    def save(*v):store.expense(*v);shift_status()
    dialog('Record expense',[('Category',''),('Amount ₹',''),('Cash / Bank / UPI / Card','Cash'),('Reason / voucher','')],save)
b=bar(pg);button(b,'Record expense',expense);button(b,'Store receipt identity',profile)
ttk.Label(pg,text='Cash drawer = opening float + cash sales − cash refunds − cash expenses. UPI and card are recorded separately.\n\nDatabase folder: '+str(DATA),padding=10,wraplength=770).pack(anchor='w')
def refresh_all():
    products(page);stocks();orders();sales();reports();shift_status()
def tab_changed(event=None):
    name=tabs.tab(tabs.select(),'text')
    if name=='Billing':scan_entry.focus()
    elif name=='Receipts':sales()
    elif name=='Reports':reports()
    elif name=='Stock':stocks()
    elif name=='Shift & backup':shift_status()
tabs.bind('<<NotebookTabChanged>>',guard(tab_changed))
def quit_app():
    if cart and not messagebox.askyesno('Unsaved basket','Exit and discard current edits to this basket?'):return
    db.close();app.destroy()
app.protocol('WM_DELETE_WINDOW',quit_app);refresh_all();notice.set('Practice codes: TRYAPPLE and TRYRICE.' if DEMO else 'Ready. Open a cashier shift in Shift & backup.');scan_entry.focus();app.mainloop()
