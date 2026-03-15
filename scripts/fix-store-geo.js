const prisma = require('../src/config/database');
(async () => {
  await prisma.store.updateMany({ where: { name: '日月潭涵碧樓' }, data: { latitude: 23.8611, longitude: 120.9106 } });
  const stores = await prisma.store.findMany({ select: { id:true, name:true, latitude:true, longitude:true }, orderBy: { id: 'asc' } });
  stores.forEach(s => {
    console.log(s.id + ' ' + s.name + ' ' + (s.latitude || '') + ',' + (s.longitude || ''));
  });
  console.log('total: ' + stores.length);
  const allHave = stores.every(s => s.latitude !== null);
  console.log('all have coords: ' + allHave);
  await prisma.$disconnect();
})();
