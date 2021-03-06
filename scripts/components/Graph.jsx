var React = require('react/addons');
var _ = require('lodash');
var d3 = require('d3/d3');

var ViewActionCreators = require('../actions/ViewActionCreators');
var CategoryStore = require('../stores/CategoryStore');
var ExpenseStore = require('../stores/ExpenseStore');
var GraphStore = require('../stores/GraphStore');
var SelectionStore = require('../stores/SelectionStore');
var AppCalculationUtils = require('../utils/AppCalculationUtils');
var CategoryComponent = require('./Category.jsx');
var ExpenseComponent = require('./Expense.jsx');
var ExpenseBarComponent = require('./ExpenseBar.jsx');
var LinkComponent = require('./Link.jsx');
var GraphDateComponent = require('./GraphDate.jsx');
var GraphVisualization = require('../visualizations/Graph');

var GraphComponent = React.createClass({
  getInitialState() {
    var left = 325;
    return {
      dragging: false,
      categories: [],
      expenses: [],
      links: [],
      dates: [],
      left: left,
      width: window.innerWidth - left,
      height: window.innerHeight
    }
  },
  componentDidMount() {
    this.d3Node = d3.select(this.getDOMNode());

    window.addEventListener('resize', _.debounce(this._onWindowResize, 200));
    GraphStore.addChangeListener(this._onChange);  
    SelectionStore.addChangeListener(this._onChange);
    this._onChange(); // remove this later, better to have it go through dispatcher
  },
  componentWillReceiveProps(nextProps) {
    this._onChange(nextProps);
  },
  componentDidUpdate() {
    this.d3Node.call(GraphVisualization.update);
  },
  componentWillUnMount() {
    window.removeEventListener('resize', this._onWindowResize);
    GraphStore.removeChangeListener(this._onChange);
    SelectionStore.removeChangeListener(this._onChange);
  },
  _onWindowResize() {
    _.defer(() => ViewActionCreators.deletePositions());

    var panel = document.getElementsByClassName('Panel')[0];
    var left = panel ? panel.offsetWidth : 325;
    var width = window.innerWidth - left;
    var height = window.innerHeight;

    this._onChange(this.props, width, height)
  },
  _onChange(props, width, height) {
    props = props || this.props;
    width = width || this.state.width;
    height = height || this.state.height;

    var selection = SelectionStore.getSelection();
    // get expenses from store for this week, and then use it to calculate expenses, 
    var expensesData = props.data.expenses;
    var categoriesData = props.data.categories;
    var categories = AppCalculationUtils.calculateCategories(expensesData);
    var expenses = AppCalculationUtils.calculateExpenses(expensesData);
    var links = AppCalculationUtils.calculateLinks(categories, expenses);
    // calculate some more rendering things
    AppCalculationUtils.calculateSizes(categories);
    AppCalculationUtils.highlightSelections(selection, categories, expenses);
    // calculate their positions
    AppCalculationUtils.setDocumentDimensions(width, height);
    var dates = AppCalculationUtils.getDatesForWeek(props.data.week, expenses);
    AppCalculationUtils.positionExpenses(expenses);
    AppCalculationUtils.positionGraph(categories, expenses, links);

    var state = {categories, expenses, links, dates, width, height};
    AppCalculationUtils.calculateUpdate(this.state, state);
    this.setState(state);

    // save the calculated positions
    _.defer(() => {
      ViewActionCreators.savePositions({
        categories: this.state.categories
      });
    }); 
  },
  findOverlappingCategory(expense) {
    return _.find(this.state.categories, (category) => {
      var x1 = category.x - category.size;
      var y1 = category.y - category.size;
      var x2 = category.x + category.size;
      var y2 = category.y + category.size;

      return x1 < expense.x && expense.x < x2 &&
             y1 < expense.y && expense.y < y2;
    });
  },

  beforeDragExpense(expense) {
    var categories = AppCalculationUtils.calculateCategories();
    var expenses = [expense];
    var links = AppCalculationUtils.calculateLinks(categories, expenses);
    _.each(categories, (category) => {
      category.size = 15;
    });
    // then put the rest of the expenses in
    _.each(this.state.expenses, (exp) => {
      if (exp.id !== expense.id) {
        expenses.push(exp);
      }
    });
    AppCalculationUtils.positionGraphBeforeDrag(categories, expenses, links);

    var state = {categories, expenses, links, dragging: expense.id};
    AppCalculationUtils.calculateUpdate(this.state, state);
    this.setState(state);
  },

  onDragExpense(expense) {
    // first replace the dragged expense in expenses array
    var expenses = _.map(this.state.expenses, (exp) => {
      if (exp.id === expense.id) return expense;
      return exp;
    });
    // then go through links and update any sides
    // that point to the expense
    var links = _.map(this.state.links, (link) => {
      if (link.source.id === expense.id) {
        return React.addons.update(link, {
          $merge: {source: expense}
        });
      }
      if (link.target.id === expense.id) {
        return React.addons.update(link, {
          $merge: {target: expense}
        });
      }
      return link;
    });

    var state = React.addons.update(this.state, {
      $merge: {expenses, links}
    });
    this.setState(state);
  },

  afterDragExpense(expense) {
    var category = this.findOverlappingCategory(expense);
    if (category) {
      ViewActionCreators.addExpenseToCategory({expense, category});
    }
    ViewActionCreators.afterDragExpense(expense);
    this.setState({dragging: false});
  },

  render() {
    var svgStyle = {
      position: 'absolute',
      width: this.state.width,
      height: this.state.height,
      left: this.state.left
    };
    var links = _.map(this.state.links, (link) => {
      var key = link.source.id + ',' + link.target.id;
      link.expenseBeingDragged = this.state.dragging;
      return (<LinkComponent key={key} data={link} />);
    });
    var categories = _.map(this.state.categories, (category) => {
      category.expenseBeingDragged = this.state.dragging;
      return (<CategoryComponent key={category.id} data={category} />);
    });
    var expenses = _.map(this.state.expenses, (expense) => {
      expense.expenseBeingDragged = this.state.dragging;
      return (<ExpenseComponent key={expense.id} data={expense}
        beforeDrag={this.beforeDragExpense} onDrag={this.onDragExpense} afterDrag={this.afterDragExpense} />);
    });
    var expenseBars = _.map(this.state.expenses, (expense) => {
      expense.expenseBeingDragged = this.state.dragging;
      return (<ExpenseBarComponent key={expense.id} data={expense} />);
    });
    var dates = _.map(this.state.dates, (date) => {
      date.expenseBeingDragged = this.state.dragging;
      return (<GraphDateComponent data={date} />);
    });

    return (
      <svg style={svgStyle}>
        <g className="graph">
          {dates}
          {links}
          {expenseBars}
          {categories}
          {expenses}
        </g>
      </svg>
    );
  }
});

module.exports = GraphComponent;