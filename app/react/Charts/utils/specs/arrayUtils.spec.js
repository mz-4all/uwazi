/* eslint-disable max-statements */
import React from 'react';
import Immutable from 'immutable';
import * as libraryFilters from 'app/Library/helpers/libraryFilters';
import colorScheme from '../colorScheme';
import arrayUtils from '../arrayUtils';

const { sortValues, formatPayload, formatDataForChart } = arrayUtils;

describe('Array Utils', () => {
  describe('sortValues', () => {
    it('should sort the passed values, ordering similar results by label', () => {
      const unsortedValues = [
        { label: 'b', results: 2 },
        { label: 'z', results: 3 },
        { label: 'z', results: 2 },
        { label: 'A', results: 2 },
      ];

      expect(sortValues(unsortedValues)[0]).toEqual({ label: 'z', results: 3 });
      expect(sortValues(unsortedValues)[1]).toEqual({ label: 'A', results: 2 });
      expect(sortValues(unsortedValues)[2]).toEqual({ label: 'b', results: 2 });
      expect(sortValues(unsortedValues)[3]).toEqual({ label: 'z', results: 2 });
    });
  });

  describe('formatPayload', () => {
    function testPayload(data, index) {
      expect(formatPayload(data)[index]).toEqual({
        color: colorScheme[index % colorScheme.length],
        formatter: jasmine.any(Function),
        type: 'rect',
        value: data[index].name,
      });

      expect(formatPayload(data)[index].formatter()).toEqual(
        <span style={{ color: '#333' }}>{data[index].name}</span>
      );
    }

    it('should map the values assigning color scheme colors', () => {
      const data = [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }];
      testPayload(data, 0);
      testPayload(data, 3);
    });
  });

  describe('formatDataForChart', () => {
    let data;
    let property;
    let thesauri;
    let options;

    beforeEach(() => {
      data = Immutable.fromJS([
        { key: 'id1', doc_count: 10, filtered: { doc_count: 3 } },
        { key: 'id3', doc_count: 5, filtered: { doc_count: 4 } },
        { key: 'id2', doc_count: 20, filtered: { doc_count: 5 } },
        { key: 'missing', label: null, filtered: { doc_count: 0 } },
        { key: 'any', label: null, filtered: { doc_count: -672 } },
      ]);
      property = 'prop';

      const values = [
        { label: 'Val 1', id: 'id1' },
        { label: 'Val 2', id: 'id2' },
        { label: 'Val 3', id: 'id3' },
      ];

      thesauri = Immutable.fromJS([
        {
          name: 'Thes',
          values,
        },
      ]);

      options = {
        context: 'contextId',
        excludeZero: false,
        maxCategories: 0,
        aggregateOthers: 'false',
      };

      jest.spyOn(libraryFilters, 'populateOptions').mockReturnValue([
        {
          content: 'contextId',
          options: values,
        },
      ]);
    });

    const expectResults = expected => {
      const results = formatDataForChart(data, property, thesauri, options);
      expect(results).toEqual(
        expected.map(item => {
          const id = Object.keys(item)[0];
          return { id, label: item[id][0], results: item[id][1] };
        })
      );
    };

    it('should aggregate filtered results for each category sorted in descending order (default)', () => {
      expectResults([{ id2: ['Val 2', 5] }, { id3: ['Val 3', 4] }, { id1: ['Val 1', 3] }]);
      expect(libraryFilters.populateOptions).toHaveBeenCalledWith(
        [{ content: options.context }],
        thesauri.toJS()
      );
    });

    it('should omit results without labels', () => {
      data = data.push(Immutable.fromJS({ key: 'id4', doc_count: 5, filtered: { doc_count: 1 } }));
      expectResults([{ id2: ['Val 2', 5] }, { id3: ['Val 3', 4] }, { id1: ['Val 1', 3] }]);
    });

    it('should allow plucking specific categories from the results, not failing if label not found', () => {
      options.pluckCategories = ['Val 1', 'missing', 'Val 3'];
      expectResults([{ id3: ['Val 3', 4] }, { id1: ['Val 1', 3] }]);
    });

    it('should allow sorting results in ascending order', () => {
      options.sort = { order: 'asc' };
      expectResults([{ id1: ['Val 1', 3] }, { id3: ['Val 3', 4] }, { id2: ['Val 2', 5] }]);
    });

    it('should allow sorting by labels alphabetically, ascending by default', () => {
      options.sort = { by: 'label' };
      expectResults([{ id1: ['Val 1', 3] }, { id2: ['Val 2', 5] }, { id3: ['Val 3', 4] }]);

      options.sort = { by: 'label', order: 'desc' };
      expectResults([{ id3: ['Val 3', 4] }, { id2: ['Val 2', 5] }, { id1: ['Val 1', 3] }]);
    });

    it('should allow avoiding sorting completely', () => {
      options.sort = { by: 'none' };
      expectResults([{ id1: ['Val 1', 3] }, { id3: ['Val 3', 4] }, { id2: ['Val 2', 5] }]);
    });

    it('should allow mapping the labels to other values', () => {
      options.labelsMap = { 'Val 2': 'V2', 'Val 3': 'V3' };
      expectResults([{ id2: ['V2', 5] }, { id3: ['V3', 4] }, { id1: ['Val 1', 3] }]);
    });

    it('should return an empty array if no labels are found for the given context', () => {
      jest
        .spyOn(libraryFilters, 'populateOptions')
        .mockReturnValue([{ content: 'contextId', options: null }]);
      const results = formatDataForChart(data, property, thesauri, options);
      expect(results).toEqual([]);
    });
  });
});
