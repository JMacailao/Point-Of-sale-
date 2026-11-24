import { useState } from 'react'
import { Plus, Pencil, Archive, ArchiveRestore, Tags, ImageOff, Search, Trash2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useApi, useDebounced } from '../../hooks/useApi'
import { api } from '../../services/api'
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorState, IconButton, ImagePicker, Input, Modal, PageHeader,
  PageLoader, Pagination, Select, Textarea, TableWrap,
} from '../../components/ui'
import { formatMoney } from '../../utils/format'

const EMPTY = { name: '', sku: '', barcode: '', category_id: '', description: '', cost_price: '', selling_price: '', minimum_stock: '', initial_stock: '0' }

function ProductForm({ open, product, categories, defaultMin, onClose, onSaved }) {
  const toast = useToast()
  const isEdit = Boolean(product)
  const [form, setForm] = useState(EMPTY)
  const [image, setImage] = useState(null)
  const [removeImage, setRemoveImage] = useState(false)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [lastOpen, setLastOpen] = useState(false)

  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setForm(product ? {
        name: product.name, sku: product.sku || '', barcode: product.barcode || '', category_id: product.category_id || '',
        description: product.description || '', cost_price: String(product.cost_price ?? ''), selling_price: String(product.selling_price),
        minimum_stock: String(product.minimum_stock), initial_stock: '0',
      } : { ...EMPTY, minimum_stock: String(defaultMin) })
      setImage(product?.image_url || null)
      setRemoveImage(false)
      setErrors({})
    }
  }
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  function validate() {
    const e = {}
    const money = /^\d+(\.\d{1,2})?$/
    if (!form.name.trim()) e.name = 'Product name is required.'
    if (!money.test(form.selling_price)) e.selling_price = 'Enter a valid price (up to 2 decimals).'
    if (form.cost_price !== '' && !money.test(form.cost_price)) e.cost_price = 'Enter a valid cost (up to 2 decimals).'
    if (form.minimum_stock !== '' && !/^\d+$/.test(form.minimum_stock)) e.minimum_stock = 'Whole number required.'
    if (!isEdit && !/^\d+$/.test(form.initial_stock)) e.initial_stock = 'Whole number required.'
    if (image instanceof File && image.size > 2 * 1024 * 1024) e.image = 'Image must be 2 MB or smaller.'
    setErrors(e)
    return !Object.keys(e).length
  }

  async function submit(e) {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)
    const fd = new FormData()
    const fields = { ...form, cost_price: form.cost_price || '0' }
    if (isEdit) delete fields.initial_stock
    Object.entries(fields).forEach(([k, v]) => fd.set(k, v))
    if (image instanceof File) fd.set('image', image)
    else if (removeImage) fd.set('remove_image', 'true')
    try {
      const { data } = isEdit ? await api.put(`/products/${product.id}`, fd) : await api.post('/products', fd)
      toast.success(isEdit ? 'Product updated' : 'Product added')
      onSaved(data)
    } catch (err) {
      toast.error(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Product' : 'Add Product'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="product-form" loading={saving}>{isEdit ? 'Save Changes' : 'Add Product'}</Button></>}>
      <form id="product-form" onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
        <Input className="sm:col-span-2" label="Product Name" required value={form.name} onChange={set('name')} error={errors.name} maxLength={160} />
        <Input label="SKU" value={form.sku} onChange={set('sku')} maxLength={64} />
        <Input label="Barcode" value={form.barcode} onChange={set('barcode')} maxLength={64} hint="Scan into this field with a barcode scanner." />
        <Select label="Category" value={form.category_id} onChange={set('category_id')} placeholder="Uncategorized" options={categories.map((c) => [c.id, c.name])} />
        <Input label="Minimum Stock" type="number" min={0} value={form.minimum_stock} onChange={set('minimum_stock')} error={errors.minimum_stock} hint="Low-stock alert threshold." />
        <Input label="Cost Price (₱)" type="number" min={0} step="0.01" inputMode="decimal" value={form.cost_price} onChange={set('cost_price')} error={errors.cost_price} />
        <Input label="Selling Price (₱)" required type="number" min={0} step="0.01" inputMode="decimal" value={form.selling_price} onChange={set('selling_price')} error={errors.selling_price} />
        {isEdit ? (
          <div className="sm:col-span-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Current stock: <b>{product.stock_quantity}</b>. Stock changes are made in <b>Stock / Inventory</b> so every change is recorded.
          </div>
        ) : (
          <Input label="Initial Stock" type="number" min={0} value={form.initial_stock} onChange={set('initial_stock')} error={errors.initial_stock} hint="Recorded as a Stock In movement." />
        )}
        <Textarea className="sm:col-span-2" label="Description" value={form.description} onChange={set('description')} maxLength={1000} />
        <div className="sm:col-span-2">
          <ImagePicker label="Product Image" value={image} hint={errors.image || 'PNG, JPEG or WebP, up to 2 MB.'}
            onChange={(f) => { setImage(f); setRemoveImage(false) }} onRemove={() => { setImage(null); setRemoveImage(true) }} />
        </div>
      </form>
    </Modal>
  )
}

function CategoriesModal({ open, onClose, categories, onChanged }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [busy, setBusy] = useState(false)

  async function save(e) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      if (editing) await api.put(`/categories/${editing.id}`, { name: name.trim(), description: editing.description })
      else await api.post('/categories', { name: name.trim() })
      toast.success(editing ? 'Category renamed' : 'Category added')
      setName(''); setEditing(null); onChanged()
    } catch (err) { toast.error(err) } finally { setBusy(false) }
  }
  async function remove() {
    setBusy(true)
    try {
      await api.del(`/categories/${deleting.id}`)
      toast.success('Category deleted')
      setDeleting(null); onChanged()
    } catch (err) { toast.error(err) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Categories">
      <form onSubmit={save} className="mb-3 flex gap-2">
        <input className="input" placeholder="Category name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Category name" />
        <Button type="submit" loading={busy} disabled={!name.trim()}>{editing ? 'Rename' : 'Add'}</Button>
        {editing && <Button variant="ghost" onClick={() => { setEditing(null); setName('') }}>Cancel</Button>}
      </form>
      {!categories.length ? <EmptyState title="No categories yet" /> : (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <span className="flex-1">{c.name}</span>
              <span className="text-xs text-slate-500">{c.product_count} products</span>
              <IconButton icon={Pencil} label={`Rename ${c.name}`} onClick={() => { setEditing(c); setName(c.name) }} />
              <IconButton icon={Trash2} label={`Delete ${c.name}`} className="hover:text-red-600" onClick={() => setDeleting(c)} />
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={Boolean(deleting)} title="Delete category?" loading={busy} confirmLabel="Delete"
        message={`"${deleting?.name}" will be deleted. Its ${deleting?.product_count || 0} products become uncategorized.`}
        onClose={() => setDeleting(null)} onConfirm={remove} />
    </Modal>
  )
}

export default function ProductsPage() {
  const { can, store } = useAuth()
  const toast = useToast()
  const manage = can('products.manage')
  const [filters, setFilters] = useState({ search: '', category_id: '', status: 'active', stock: 'all', sort: 'name', order: 'asc', page: 1 })
  const search = useDebounced(filters.search)
  const list = useApi('/products', { ...filters, search, pageSize: 20 })
  const categories = useApi('/categories')
  const [form, setForm] = useState({ open: false, product: null })
  const [showCategories, setShowCategories] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const setF = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value, page: 1 }))
  const m = (v) => formatMoney(v, store.currency)

  async function toggleArchive() {
    setBusy(true)
    try {
      if (confirm.is_active) await api.del(`/products/${confirm.id}`)
      else await api.post(`/products/${confirm.id}/restore`)
      toast.success(confirm.is_active ? 'Product archived' : 'Product restored')
      setConfirm(null)
      list.reload()
    } catch (err) { toast.error(err) } finally { setBusy(false) }
  }

  const sortValue = `${filters.sort}:${filters.order}`
  return (
    <div>
      <PageHeader title="Products" description={manage ? 'Manage your catalog, prices and images.' : 'Product catalog (view only).'}
        actions={manage && <>
          <Button variant="secondary" icon={Tags} onClick={() => setShowCategories(true)}>Categories</Button>
          <Button icon={Plus} onClick={() => setForm({ open: true, product: null })}>Add Product</Button>
        </>} />

      <div className="rounded-md border border-slate-200 bg-white">
        <div className="flex flex-wrap gap-2 border-b border-slate-200 p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-8" placeholder="Search name, SKU, barcode" value={filters.search} onChange={setF('search')} aria-label="Search products" />
          </div>
          <select className="input w-auto" value={filters.category_id} onChange={setF('category_id')} aria-label="Category">
            <option value="">All categories</option>
            {(categories.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="input w-auto" value={filters.stock} onChange={setF('stock')} aria-label="Stock filter">
            <option value="all">All stock</option><option value="low">Low stock</option><option value="out">Out of stock</option><option value="in">In stock</option>
          </select>
          {manage && (
            <select className="input w-auto" value={filters.status} onChange={setF('status')} aria-label="Status">
              <option value="active">Active</option><option value="archived">Archived</option><option value="all">All statuses</option>
            </select>
          )}
          <select className="input w-auto" value={sortValue} aria-label="Sort"
            onChange={(e) => { const [sort, order] = e.target.value.split(':'); setFilters((f) => ({ ...f, sort, order, page: 1 })) }}>
            <option value="name:asc">Name A–Z</option><option value="name:desc">Name Z–A</option>
            <option value="selling_price:asc">Price low–high</option><option value="selling_price:desc">Price high–low</option>
            <option value="stock_quantity:asc">Stock low–high</option><option value="stock_quantity:desc">Stock high–low</option>
            <option value="created_at:desc">Newest</option>
          </select>
        </div>

        {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data ? <PageLoader /> : !list.data.length ? (
          <EmptyState title="No products found" message={manage ? 'Add your first product to start selling.' : 'No products match your filters.'}
            action={manage && <Button icon={Plus} onClick={() => setForm({ open: true, product: null })}>Add Product</Button>} />
        ) : (
          <TableWrap>
            <table className={`table ${list.loading ? 'opacity-60' : ''}`}>
              <thead><tr>
                <th>Product</th><th className="hidden md:table-cell">Category</th>
                {manage && <th className="num hidden sm:table-cell">Cost</th>}
                <th className="num">Price</th><th className="num">Stock</th><th className="hidden sm:table-cell">Status</th>
                {manage && <th className="w-20"><span className="sr-only">Actions</span></th>}
              </tr></thead>
              <tbody>
                {list.data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50">
                          {p.image_url ? <img src={p.image_url} alt="" loading="lazy" className="size-full object-cover" /> : <ImageOff className="size-4 text-slate-300" />}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{p.name}</p>
                          <p className="truncate text-xs text-slate-500">{[p.sku, p.barcode].filter(Boolean).join(' · ') || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden text-slate-600 md:table-cell">{p.category_name || '—'}</td>
                    {manage && <td className="num hidden text-slate-600 sm:table-cell">{m(p.cost_price)}</td>}
                    <td className="num font-medium">{m(p.selling_price)}</td>
                    <td className="num">
                      {p.stock_quantity === 0 ? <Badge tone="red">Out</Badge> : p.is_low_stock ? <Badge tone="amber">{p.stock_quantity} low</Badge> : p.stock_quantity}
                    </td>
                    <td className="hidden sm:table-cell">{p.is_active ? <Badge tone="green">Active</Badge> : <Badge>Archived</Badge>}</td>
                    {manage && (
                      <td className="whitespace-nowrap text-right">
                        <IconButton icon={Pencil} label={`Edit ${p.name}`} onClick={() => setForm({ open: true, product: p })} />
                        <IconButton icon={p.is_active ? Archive : ArchiveRestore} label={p.is_active ? `Archive ${p.name}` : `Restore ${p.name}`}
                          onClick={() => setConfirm(p)} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination meta={list.meta} onPage={(page) => setFilters((f) => ({ ...f, page }))} />
      </div>

      {manage && <>
        <ProductForm open={form.open} product={form.product} categories={categories.data || []} defaultMin={store.default_low_stock_threshold}
          onClose={() => setForm({ open: false, product: null })}
          onSaved={() => { setForm({ open: false, product: null }); list.reload(); categories.reload() }} />
        <CategoriesModal open={showCategories} onClose={() => setShowCategories(false)} categories={categories.data || []}
          onChanged={() => { categories.reload(); list.reload() }} />
        <ConfirmDialog open={Boolean(confirm)} loading={busy} onClose={() => setConfirm(null)} onConfirm={toggleArchive}
          variant={confirm?.is_active ? 'danger' : 'primary'}
          title={confirm?.is_active ? 'Archive product?' : 'Restore product?'} confirmLabel={confirm?.is_active ? 'Archive' : 'Restore'}
          message={confirm?.is_active ? `"${confirm?.name}" will no longer be available for sale. Sales history is kept.` : `"${confirm?.name}" will be available for sale again.`} />
      </>}
    </div>
  )
}
