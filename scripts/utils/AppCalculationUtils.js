var _ = require('lodash');
var d3 = require('d3/d3');
var AppDispatcher = require('../dispatcher/AppDispatcher');
var CategoryStore = require('../stores/CategoryStore');
var ExpenseStore = require('../stores/ExpenseStore');
var GraphStore = require('../stores/GraphStore');
var SelectionStore = require('../stores/SelectionStore');

var AppCalculationUtils = {};

/** Gets info from CategoryStore and calculates data
* to render with, such as name, fill, size, etc.
* @return {Array} Array of renderable category objects
*/
var colorScale = d3.scale.category10();
AppCalculationUtils.calculateCategory = (category, expensesData) => {
  // to get the size of the category, get all the expenses
  // that are in the category, and add um their amounts
  var total = _.chain(expensesData)
    .filter((expense) => _.includes(expense.categories, category.id))
    .reduce((memo, expense) => {
      return memo + expense.amount;
    }, 0).value();

  return {
    id: category.id,
    name: category.name,
    fill: colorScale(category.name),
    total: total
  }
};
AppCalculationUtils.calculateCategories = (expensesData, categories) => {
  categories = categories || CategoryStore.getAll();
  return _.chain(categories)
    .map((category) => {
      return AppCalculationUtils.calculateCategory(category, expensesData);
    }).sortBy((category) => {
      return -category.total;
    }).value();
};

var dateFormat = d3.time.format('%m/%d (%a)');
AppCalculationUtils.calculateExpenses = (expensesData) => {
  return _.map(expensesData, (expense) => {
    return {
      id: expense.id,
      name: expense.name,
      size: 10,
      total: expense.amount
    };
  });
};

/** Takes the categories and expenses to be rendered (nodes)
* and calculates the links between them
* @param {Array} categories As returned by calculateCategories
* @param {Array} expenses As returned by calculateExpenses
* @return {Array} links between expenses and categories
*/
AppCalculationUtils.calculateLinks = (categories, expenses) => {
  var links = [];
  _.each(expenses, (expense) => {
    // for each of the expenses, link it to the categories it belongs to
    var target = expense;
    _.each(ExpenseStore.get(expense.id).categories, (categoryId) => {
      var source = _.find(categories, (category) => category.id === categoryId);
      if (target) {
        links.push({source, target});
      }
    });
  });

  return links;
};

AppCalculationUtils.highlightSelections = (selection, categories, expenses) => {
  if (!selection) return;

  if (selection.type === 'category') {
    var category = _.find(categories, (category) => category.id === selection.id);
    if (category) {
      category.selected = true;
      _.each(expenses, (expense) => {
        var exp = ExpenseStore.get(expense.id);
        if (_.includes(exp.categories, selection.id)) {
          expense.highlighted = true;
        }
      });
    }
  } else if (selection.type === 'expense') {
    var expense = _.find(expenses, (expense) => expense.id === selection.id);
    if (expense) {
      expense.selected = true;
      _.each(ExpenseStore.get(expense.id).categories, (categoryId) => {
        var category = _.find(categories, (category) => category.id === categoryId);
        category.highlighted = true;
      });
    }
  }
}

var categoryScale = d3.scale.linear().range([7.5, 60]);
AppCalculationUtils.calculateSizes = (categories) => {
  var min = d3.min(categories, (category) => category.total) || 0;
  var max = d3.max(categories, (category) => category.total) || 1;
  max = Math.max(max, 100);

  categoryScale.domain([min, max]);
  _.each(categories, (category) => {
    category.size = categoryScale(category.total);
  });
}

AppCalculationUtils.calculateUpdate = (prev, next) => {
  _.each(next.categories, (category) => {
    var prevCategory = _.find(prev.categories, (prevCategory) => prevCategory.id === category.id);
    if (prevCategory) {
      delete prevCategory.update;
      // if there was previously the same category, and some update has happened
      category.update = !_.isEqual(prevCategory, category);
    }
  });
  _.each(next.expenses, (expense) => {
    var prevExpense = _.find(prev.expenses, (prevExpense) => prevExpense.id === expense.id);
    if (prevExpense) {
      delete prevExpense.update;
      expense.update = !_.isEqual(prevExpense, expense);
    }
  });
  _.each(next.dates, (date) => {
    var prevDate = _.find(prev.dates, (prevDate) => _.isEqual(prevDate.date === date.date));
    if (prevDate) {
      delete prevDate.update;
      date.update = !_.isEqual(prevDate, date);
    }
  });
}

// positioning functions
var width;
var height;
var categoryHeight;
var padding = {top: 75, left: 125};
var dateHeight;
AppCalculationUtils.setDocumentDimensions = (docWidth, docHeight) => {
  width = docWidth;
  height = docHeight;
  categoryHeight = height / 3;
  dateHeight = (height - categoryHeight - padding.top) / 7;
}

var dayInMS = 86400000; // 86,400,000 milliseconds in a day
AppCalculationUtils.getDatesForWeek = (week, expenses) => {
  return _.map(_.range(7), (i) => {
    var date = new Date(week.getTime() + i * dayInMS);
    var total = _.chain(expenses)
      .filter((expense) => {
        var exp = ExpenseStore.get(expense.id);
        return exp.timestamp.getDay() === i; // if date matches
      }).reduce((memo, expense) => {
        return memo + expense.total;
      }, 0).value();
    var fill = (i % 2 === 0 ? '#fff' : '#efefef');

    return {
      date: date,
      formattedDate: dateFormat(date),
      x: padding.left,
      y: dateHeight * i + padding.top,
      width: width,
      height: dateHeight,
      total: total,
      fill: fill
    }
  });
}

var expenseScale = d3.scale.linear();
AppCalculationUtils.positionExpenses = (expenses) => {
  var expensesByDay = _.groupBy(expenses, (expense) => {
    var exp = ExpenseStore.get(expense.id);
    return exp.timestamp.getDay();
  });

  var maxWidth = 0;
  _.each(expensesByDay, (expensesOfDay, day) => {
    var total = _.reduce(expensesOfDay, (memo, expense) => {
      return memo + expense.total + expense.size;
    }, 0);
    maxWidth = Math.max(maxWidth, total);
  });
  maxWidth = Math.max(maxWidth, 200);

  expenseScale.domain([0, maxWidth])
    .range([0, width - 2 * padding.left]);
  _.each(expensesByDay, (expensesOfDay, day) => {
    var x = padding.left;
    _.each(expensesOfDay, (expense, i) => {
      expense.order = i;
      expense.x1 = x;
      expense.x = x += expenseScale(expense.total) + expense.size;
      expense.y = dateHeight * day + padding.top;
      expense.fixed = true;
    });
  });
}

var force = d3.layout.force()
  .linkDistance(75)
  .charge((d) => -Math.pow(d.size * 2, 2));
AppCalculationUtils.positionGraph = (categories, expenses, links) => {
  // first apply any positions that have been saved
  var nodes = _.union(categories, expenses);
  force.size([width, categoryHeight])
    .nodes(nodes).links(links)
    .on('tick', () => {
      // make sure categories don't go out of bounds
      _.each(categories, (d) => {
        var x1 = d.x - d.size;
        var y1 = d.y - d.size;
        var x2 = d.x + d.size;
        var y2 = d.y + d.size;
        if (x1 < 0) {
          // if it's hitting the left bound
          d.x = d.size + padding.left / 2;
        } else if (x2 > width) {
          // if it's hitting right bound
          d.x = width - d.size - padding.left / 2;
        }
        if (y1 < height - categoryHeight) {
          d.y = (height - categoryHeight) + d.size;
        } else if (y2 > height) {
          d.y = height - d.size;
        }
      });
    }).start();

  _.each(_.range(1000), () => force.tick());
  force.stop();
  _.each(nodes, (node) => cleanNodeAfterForceCalculation(node));
};

var forceForDrag = d3.layout.force();
AppCalculationUtils.positionGraphBeforeDrag = (categories, expenses, links) => {
  var nodes = _.union(categories, expenses);
  var foci = {x: expenses[0].x, y: expenses[0].y};
  force.size([width, height])
    .nodes(nodes).links(links)
    .on('tick', (e) => {
      var k = e.alpha;
      _.each(categories, (d) => {
        d.x += (foci.x - d.x) * k;
        d.y += (foci.y - d.y) * k;
      });
    }).start();
  _.each(_.range(1000), () => force.tick());
  force.stop();
  _.each(nodes, (node) => cleanNodeAfterForceCalculation(node));
}

function cleanNodeAfterForceCalculation(node) {
  delete node.index;
  delete node.px;
  delete node.py;
  delete node.weight;
}

module.exports = AppCalculationUtils;