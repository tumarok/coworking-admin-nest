import type { Clock } from '../../common/clock/clock.js';
import type { Location } from '../../contract/index.js';
import type { LocationsRepository } from './locations.repository.js';
import { LocationsService } from './locations.service.js';

const location: Location = {
  id: 'loc_1',
  name: 'Riverside Hub',
  city: 'Kyiv',
  address: '12 Naberezhna St',
  timezone: 'Europe/Kyiv',
  opensAt: '08:00',
  closesAt: '21:00',
  status: 'active',
  roomCount: 0,
};
const body = { ...location, id: undefined, roomCount: undefined };

describe('LocationsService.update', () => {
  const service = (repository: Partial<LocationsRepository>) =>
    new LocationsService(repository as LocationsRepository, {} as Clock);

  it('answers 404 when the location is deleted between the lookup and the update', async () => {
    const subject = service({
      find: () => Promise.resolve(location),
      update: () => Promise.resolve(undefined),
    });

    await expect(subject.update('loc_1', body)).rejects.toMatchObject({
      status: 404,
      response: { message: 'Location not found' },
    });
  });

  it('does not touch the repository for a body that fails the schema', async () => {
    const update = vi.fn();
    const subject = service({ find: () => Promise.resolve(location), update });

    await expect(subject.update('loc_1', { name: 'X' })).rejects.toMatchObject({ status: 422 });
    expect(update).not.toHaveBeenCalled();
  });
});
