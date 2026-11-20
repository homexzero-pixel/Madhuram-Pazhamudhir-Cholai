"""Single-counter retail ledger. Quantities use thousandths, money uses paise."""
import csv
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

def fixed(value, scale, allow_zero=False):
    try:
        n=Decimal(str(value))*scale
        if not n.is_finite() or n!=n.to_integral_value() or n<0 or n>10**10 or (not allow_zero and n==0):
            raise ValueError
        return int(n)
    except (InvalidOperation,ValueError):
        raise ValueError('Enter a valid positive number with the correct decimal places (zero is allowed for cash counts).')

def money(paise): return f'{paise/100:,.2f}'
def qty(milli): return f'{milli/1000:.3f}'.rstrip('0').rstrip('.')
def today(): return date.today().isoformat()
def stamp(): return datetime.now().isoformat(timespec='seconds')
def amount(p,q): return (p*q+500)//1000

class Store:
    def __init__(self, path, catalogue):
        self.db=sqlite3.connect(path,isolation_level=None,timeout=5)
        self.db.row_factory=sqlite3.Row
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS product(sku TEXT PRIMARY KEY,name TEXT NOT NULL,dept TEXT,category TEXT,unit TEXT,barcode TEXT UNIQUE,price INTEGER,mrp INTEGER);
        CREATE INDEX IF NOT EXISTS by_category ON product(category);
        CREATE TABLE IF NOT EXISTS lot(id INTEGER PRIMARY KEY,sku TEXT REFERENCES product,qty INTEGER NOT NULL CHECK(qty>=0),supplier TEXT,reference TEXT,batch TEXT,expiry TEXT,cost INTEGER,received TEXT);
        CREATE UNIQUE INDEX IF NOT EXISTS lot_reference ON lot(supplier,reference,sku,batch);
        CREATE INDEX IF NOT EXISTS lot_sku ON lot(sku);
        CREATE TABLE IF NOT EXISTS shift(id INTEGER PRIMARY KEY,cashier TEXT,opened TEXT,opening INTEGER,closed TEXT,counted INTEGER,variance INTEGER);
        CREATE UNIQUE INDEX IF NOT EXISTS one_shift ON shift((1)) WHERE closed IS NULL;
        CREATE TABLE IF NOT EXISTS sale(id INTEGER PRIMARY KEY,shift_id INTEGER REFERENCES shift,time TEXT,customer TEXT,method TEXT,total INTEGER,tender INTEGER);
        CREATE TABLE IF NOT EXISTS line(id INTEGER PRIMARY KEY,sale_id INTEGER REFERENCES sale,sku TEXT REFERENCES product,name TEXT,category TEXT,unit TEXT,qty INTEGER,price INTEGER,total INTEGER,cost INTEGER);
        CREATE TABLE IF NOT EXISTS refund(id INTEGER PRIMARY KEY,line_id INTEGER UNIQUE REFERENCES line,shift_id INTEGER REFERENCES shift,time TEXT,reason TEXT,method TEXT,total INTEGER);
        CREATE TABLE IF NOT EXISTS movement(id INTEGER PRIMARY KEY,time TEXT,lot_id INTEGER REFERENCES lot,delta INTEGER,reason TEXT,reference TEXT);
        CREATE TABLE IF NOT EXISTS tax(sku TEXT PRIMARY KEY REFERENCES product,hsn TEXT,rate INTEGER);
        CREATE TABLE IF NOT EXISTS retail_profile(id INTEGER PRIMARY KEY CHECK(id=1),legal TEXT,address TEXT,gstin TEXT);
        CREATE TABLE IF NOT EXISTS bill_profile(sale_id INTEGER PRIMARY KEY REFERENCES sale,legal TEXT,address TEXT,gstin TEXT);
        CREATE TABLE IF NOT EXISTS line_tax(line_id INTEGER PRIMARY KEY REFERENCES line,hsn TEXT,rate INTEGER,base INTEGER,central INTEGER,state INTEGER);
        CREATE TABLE IF NOT EXISTS spend(id INTEGER PRIMARY KEY,shift_id INTEGER REFERENCES shift,time TEXT,category TEXT,amount INTEGER,method TEXT,note TEXT);
        CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,supplier TEXT,sku TEXT REFERENCES product,qty INTEGER,received INTEGER DEFAULT 0,cost INTEGER,due TEXT);
        CREATE TABLE IF NOT EXISTS held(id INTEGER PRIMARY KEY,label TEXT,cart TEXT);
        """)
        if not self.db.execute('select 1 from product limit 1').fetchone():
            with self.tx(),open(catalogue,encoding='utf-8-sig',newline='') as f:
                self.db.executemany('insert into product(sku,name,dept,category,unit) values(?,?,?,?,?)',
                    ((r['SKU'],r['Product name'],r['Department'],r['Category'],r['Sale unit']) for r in csv.DictReader(f)))
    @contextmanager
    def tx(self):
        if self.db.in_transaction:
            yield
            return
        self.db.execute('BEGIN IMMEDIATE')
        try:
            yield
            self.db.commit()
        except BaseException:
            self.db.rollback()
            raise
    def item(self,code):
        p=self.db.execute('select * from product where sku=? or barcode=?',(code.upper(),code)).fetchone()
        if not p: raise ValueError('Unknown barcode or SKU. Link this pack in Products before billing.')
        return p
    def setup(self,sku,name,dept,cat,unit,barcode,price,mrp):
        price,mrp=fixed(price,100),fixed(mrp,100)
        sku=sku.strip().upper(); barcode=barcode.strip()
        if not sku or not name.strip() or not cat.strip() or not dept.strip() or unit not in ('kg','pack') or price>mrp:
            raise ValueError('Enter SKU, name, department, category, sale unit and a price within MRP.')
        with self.tx():
            old=self.db.execute('select unit from product where sku=?',(sku,)).fetchone()
            if old and old[0]!=unit: raise ValueError('Use a new SKU for a different sale unit.')
            if self.db.execute('select 1 from product where sku!=? and (upper(barcode)=? or upper(sku)=upper(?) or barcode=?)',(sku,sku,barcode,barcode)).fetchone():
                raise ValueError('Barcode or SKU already belongs to another pack.')
            self.db.execute("""insert into product values(?,?,?,?,?,?,?,?) on conflict(sku) do update set
            name=excluded.name,dept=excluded.dept,category=excluded.category,barcode=excluded.barcode,price=excluded.price,mrp=excluded.mrp""",
            (sku,name.strip(),dept.strip(),cat.strip(),unit,barcode or None,price,mrp))
    def quantity(self,p,v):
        q=fixed(v,1000)
        if p['unit']=='pack' and q%1000: raise ValueError('Use whole packs. Loose kg accepts three decimal places.')
        return q
    def receive(self,code,v,cost,supplier,ref,batch,expiry,order=None):
        p=self.item(code); q=self.quantity(p,v); cost=fixed(cost,100)
        if not supplier.strip() or not ref.strip(): raise ValueError('Enter supplier and invoice reference.')
        if expiry and (date.fromisoformat(expiry).isoformat()!=expiry or expiry<today()): raise ValueError('Enter an unexpired ISO date (YYYY-MM-DD).')
        with self.tx():
            if order:
                hit=self.db.execute('update orders set received=received+? where id=? and sku=? and supplier=? and received+?<=qty',(q,order,p['sku'],supplier.strip(),q))
                if not hit.rowcount:raise ValueError('Receipt exceeds outstanding quantity or mismatches order.')
            row=self.db.execute('insert into lot(sku,qty,supplier,reference,batch,expiry,cost,received) values(?,?,?,?,?,?,?,?)',
                (p['sku'],q,supplier.strip(),ref.strip(),batch.strip(),expiry or None,cost,stamp()))
            self.move(row.lastrowid,q,'Receipt',ref)
    def move(self,lot,q,reason,ref):
        self.db.execute('insert into movement(time,lot_id,delta,reason,reference) values(?,?,?,?,?)',(stamp(),lot,q,reason,ref))
    def waste(self,lot,v,reason):
        with self.tx():
            r=self.db.execute('select * from lot where id=?',(lot,)).fetchone()
            if not r or not reason.strip():raise ValueError('Choose a lot and enter the reason.')
            q=self.quantity(self.item(r['sku']),v)
            if q>r['qty']:raise ValueError('Adjustment exceeds lot stock.')
            self.db.execute('update lot set qty=qty-? where id=?',(q,lot));self.move(lot,-q,'Write-off',reason)
    def active(self):
        s=self.db.execute('select * from shift where closed is null').fetchone()
        if not s:raise ValueError('Open a cashier shift first.')
        return s
    def open(self,cashier,cash):
        if not cashier.strip():raise ValueError('Enter cashier name.')
        with self.tx():
            self.db.execute('insert into shift(cashier,opened,opening) values(?,?,?)',(cashier.strip(),stamp(),fixed(cash,100,True)))
    def expected(self,s):
        def cash(tab):return self.db.execute(f"select coalesce(sum(total),0) from {tab} where shift_id=? and method='Cash'",(s['id'],)).fetchone()[0]
        return s['opening']+cash('sale')-cash('refund')-self.db.execute("select coalesce(sum(amount),0) from spend where shift_id=? and method='Cash'",(s['id'],)).fetchone()[0]
    def close(self,v):
        with self.tx():
            s=self.active();count=fixed(v,100,True);diff=count-self.expected(s)
            self.db.execute('update shift set closed=?,counted=?,variance=? where id=?',(stamp(),count,diff,s['id']))
            return diff
    def quote(self,cart):
        if not cart:raise ValueError('Add an item to the bill.')
        rows=[]
        for code,v in cart.items():
            p=self.item(code);q=self.quantity(p,v)
            if not p['price']: raise ValueError('Set selling price in Products for '+p['sku'])
            rows.append((p,q,amount(p['price'],q)))
        return rows
    def checkout(self,cart,method,tender,customer='',held=None):
        with self.tx():
            s=self.active();rows=self.quote(cart)
            if method not in ('Cash','UPI','Card'):raise ValueError('Select payment method.')
            total=sum(r[2] for r in rows); paid=fixed(tender,100,True) if method=='Cash' else total
            if paid<total:raise ValueError('Cash received is below the bill total.')
            sale=self.db.execute('insert into sale(shift_id,time,customer,method,total,tender) values(?,?,?,?,?,?)',(s['id'],stamp(),customer,method,total,paid)).lastrowid
            profile=self.db.execute('select * from retail_profile where id=1').fetchone()
            if profile:self.db.execute('insert into bill_profile values(?,?,?,?)',(sale,profile['legal'],profile['address'],profile['gstin']))
            for p,q,line_amount in rows:
                remaining=q;cost=0
                lots=list(self.db.execute('select * from lot where sku=? and qty>0 and (expiry is null or expiry>=?) order by expiry is null,expiry,id',(p['sku'],today())))
                for lot in lots:
                    take=min(remaining,lot['qty'])
                    self.db.execute('update lot set qty=qty-? where id=?',(take,lot['id']));self.move(lot['id'],-take,'Sale',str(sale))
                    cost+=take*lot['cost'];remaining-=take
                    if not remaining:break
                if remaining:raise ValueError('Insufficient unexpired stock for '+p['name'])
                line_id=self.db.execute('insert into line(sale_id,sku,name,category,unit,qty,price,total,cost) values(?,?,?,?,?,?,?,?,?)',(sale,p['sku'],p['name'],p['category'],p['unit'],q,p['price'],line_amount,(cost+500)//1000)).lastrowid
                tax=self.db.execute('select * from tax where sku=?',(p['sku'],)).fetchone()
                if profile and profile['gstin'] and not tax:raise ValueError('Configure HSN and GST for '+p['sku'])
                if tax:
                    den=10000+tax['rate'];base=(line_amount*10000+den//2)//den
                    total_tax=line_amount-base
                    self.db.execute('insert into line_tax values(?,?,?,?,?,?)',(line_id,tax['hsn'],tax['rate'],base,total_tax//2,total_tax-total_tax//2))
            if held and not self.db.execute('delete from held where id=?',(held,)).rowcount:raise ValueError('Held bill already cleared.')
            return sale
    def refund(self,line,reason):
        if not reason.strip():raise ValueError('Enter return reason.')
        with self.tx():
            s=self.active()
            r=self.db.execute('select l.*,s.method from line l join sale s on s.id=l.sale_id where l.id=?',(line,)).fetchone()
            if not r:raise ValueError('Unknown receipt line.')
            if self.db.execute('select 1 from refund where line_id=?',(line,)).fetchone():raise ValueError('Line already refunded.')
            self.db.execute('insert into refund(line_id,shift_id,time,reason,method,total) values(?,?,?,?,?,?)',(line,s['id'],stamp(),reason,r['method'],r['total']))

    def set_tax(self,sku,hsn,rate):
        if not (hsn.isdigit() and len(hsn) in (4,6,8)): raise ValueError('Enter a 4, 6 or 8 digit HSN.')
        r=fixed(rate,100,True)
        if r>10000:raise ValueError('Check GST percentage.')
        self.db.execute('insert or replace into tax values(?,?,?)',(self.item(sku)['sku'],hsn,r))
    def import_products(self,path):
        count=0
        with self.tx(),open(path,encoding='utf-8-sig',newline='') as f:
            rows=csv.DictReader(f)
            required=['SKU','Product name','Department','Category','Sale unit','Pack barcode','Selling price INR','MRP INR','HSN','GST rate']
            if not all(k in (rows.fieldnames or []) for k in required):raise ValueError('Use the supplied catalogue CSV column headings.')
            seen=set()
            for i,r in enumerate(rows,2):
                if not any(r.get(k) for k in ('Selling price INR','MRP INR','Pack barcode','HSN','GST rate')):continue
                try:
                    v=[(r[k] or '').strip() for k in required]
                    if v[0].upper() in seen:raise ValueError('Duplicate SKU in import.')
                    seen.add(v[0].upper())
                    self.setup(*v[:8])
                    if v[8] or v[9]:self.set_tax(v[0],v[8],v[9])
                except (ValueError,sqlite3.Error) as e:raise ValueError(f'CSV row {i}: {e}') from e
                count+=1
        return count
    def order(self,supplier,code,v,cost,due):
        p=self.item(code)
        if not supplier.strip() or date.fromisoformat(due).isoformat()!=due:raise ValueError('Enter supplier and ISO due date.')
        self.db.execute('insert into orders(supplier,sku,qty,cost,due) values(?,?,?,?,?)',(supplier.strip(),p['sku'],self.quantity(p,v),fixed(cost,100),due))
    def expense(self,category,v,method,note):
        if not category.strip() or not note.strip() or method not in ('Cash','Bank','UPI','Card'):raise ValueError('Enter category, reference and Cash, Bank, UPI or Card.')
        with self.tx():
            self.db.execute('insert into spend(shift_id,time,category,amount,method,note) values(?,?,?,?,?,?)',(self.active()['id'],stamp(),category,fixed(v,100),method,note))
